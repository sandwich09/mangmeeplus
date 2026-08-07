# Agent Memory: M-01 AI actor delegation

Status: Code/test remediation complete; clean-CI artifact and isolated UAT live-verification path added on 2026-07-25; immutable deployment and live evidence capture are in progress.
Owner: Platform/AI Security.
Scope: API-issued actor delegation, Gateway/AgentCore propagation, ERP verification/replay protection/audit, production config, checklist evidence.
Decisions: Dedicated API-only 256-bit HMAC key independent from the workload/data-protection keys; bounded pool of eight 120-second single-use tokens per permitted tool; shared Redis atomic consume; current DB access remains authoritative; fail closed; delegation fields and reflected downstream errors are redacted. Live adversarial requests run only from a short-lived API task in isolated UAT; AgentCore deploy consumes a checksum-bound clean-CI CodeZip.
Open questions: None.
Artifacts: `docs/specs/line-ai-local-agent-orchestration-spec.md` section 21; `docs/plans/security-remediation-m-01-actor-delegation-plan.md`; `infra/ai-gateway/m01-actor-delegation.spec.sh`; `infra/ai-gateway/build-agentcore-artifact.sh`; `infra/uat/m01-actor-delegation-alert.sh`; M-01 checklist evidence.
Verification: API 2172/2172; AI Gateway/AgentCore 417/417; config 57/57; focused M-01 API 13/13; focused AI boundary 53/53; release-task render/static boundary checks, API typecheck, deployment shell syntax, and `git diff --check` passed after adding the live path.
Next: Publish the exact revision through clean CI, deploy UAT and AgentCore artifacts, run the UAT probe and alert drill, deploy the accepted immutable revision to production, verify sanitized live configuration, then tick M-01. Keep AC-03/AC-04 open until their other findings close.
