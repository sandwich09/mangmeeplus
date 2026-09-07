# Agent Memory: Receipt and signup release 2026-09-07

Status: Preparing release; no UAT/READY/Production run dispatched for this candidate.
Owner: Release controller under the owner's explicit UAT → Production live authorization.
Scope: Ship merged receipt reliability, trial/onboarding and signup/support recovery changes; enable the two receipt flags in both environments. Defer Production mail provider activation.
Decisions: LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED=true and LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED=true in UAT and Production live. Preserve explicit false rollback and maintenance quiescence. Production EMAIL_PROVIDER=disabled; existing UAT SES sandbox unchanged. Preserve environment identities, security controls and existing AI/signup parity. Legal owner authorization already recorded as OWNER-DIRECTIVE-2026-09-07-UAT-PROD-PARITY; no legal evidence is manufactured.
Open questions: None for authorized preparation. Current administrator browser acceptance must be proved with the current enabled identity, never the revoked seed account.
Artifacts: Existing receipt-reliability-and-draft-continuity plan, onboarding-trial-receipt-fixes plan, line-signup-recovery-and-resolution plan; this release ledger; mandatory uat-production-v2-deployment and cloud-environment-operations runbooks.
Verification: Pending focused deployment config/maintenance checks, full required candidate CI, signed UAT Passport, signed live READY, signed Production result, runtime flag/config parity and customer OPEN acceptance.
Next: Wire missing flags in deploy script/workflow environment, verify, merge reviewed source into develop/main, freeze controller, then release exact tested source through the mandatory protocol.

## Preparation plan and acceptance

1. Trace both feature consumers: only API reads these flags. Extend existing deploy inputs, boolean validation, serving-mode mapping and API container environment; workflow environment variables must permit an explicit false override.
2. Execute default-on and explicit-off config checks, invalid boolean rejection, actual maintenance serving mapping and API render contract. Keep Production SES rejection and valid sender fallback. Synchronize exact maintenance enforcement pins.
3. Correct the stale customer acceptance identity in the release runbook using signed admin cutover evidence already retained in the previous release memory. Require current identity, SYSTEM_ADMIN, system.launch_gate.manage, OPEN readback and logout invalidation.
4. Inspect cloud prerequisites and six stable services without exposing secrets. Select a reviewed candidate with actual required CI, reachable from main and develop and matching controller workflow blobs.
5. Record one UAT dispatch and its auto READY, verify their terminal evidence, then standalone live READY with the owner's recorded authorization, then Production from the same signed image digests. No overlapping or duplicate runs.
6. Read effective running feature values, model choices, trial allowance and environment-specific exceptions after rollout. Complete current-admin customer OPEN acceptance; report only the state proved by evidence.

## Release ledger

- Previous live source: 604ac785479ced5b9858d0b46d89f8d11cf2b9f6; Production run 34078121808.
- Candidate source / full CI / controller: pending preparation PR.
- UAT / auto READY / live READY / Production: not dispatched.
- Signed digests and customer acceptance: pending.

## Preflight and implementation evidence

- Both flag consumers are API-only; cloud deployment now supplies them via workflow variables, exact boolean validation and serving-mode mapping. Application schema defaults remain false outside the cloud deployment.
- `production-serving-mode.spec.sh` PASS: UAT/live defaults true, Production/live defaults true, explicit false preserved, malformed values refused, maintenance overrides true to false, API-only render wiring and workflow variable mappings checked. Production SES activation remains refused and its sender fallback remains valid.
- `production-deploy-workflow-v2.spec.sh`, `production-readiness-workflow-v2.spec.sh`, `validate-production-maintenance-release.spec.sh`, `sync-production-maintenance-release-pins.spec.sh`, `release-safety.spec.sh`: PASS. Image security aggregate recheck in progress with isolated exit status. `git diff --check`: PASS.
- AWS non-root identity: watchdog-bedrock-dev in account311414082667. UAT read-only deploy readiness PASS. All six Express services ACTIVE with one active configuration and capacity1/2, source604ac785. Both API environments currently trial10 and missing the two flags; this release changes those to15/true/true. Both gateways use global Sonnet4.6 and AgentCore. Production mail disabled / UAT ses preserved.
- GitHub environment variables read back true for both required flags in uat and production. This changes the next workflow inputs only; running services have not been mutated.
- Existing authenticated Chrome Production platform-access page shows deployment live and customer Open. No gate mutation or logout performed during preparation.
- Owner reconfirmed that the required final Production state is live and usable, never maintenance. No maintenance Production deployment is planned; maintenance assertions above are local tests only.
