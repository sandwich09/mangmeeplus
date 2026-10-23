# Agent Memory: UAT power resume — 2026-10-09

Status: COMPLETED — UAT_RUNNING_OPEN at 2026-10-09 19:47 Asia/Bangkok
Subsequent state: owner requested “ปิด uat” on October10; both application hosts stopped with data retained. See [latest pause evidence](uat-power-pause-2026-10-10.md). The resume result below remains historical.
Owner: primary agent following owner request “เปิด uat”.
Scope: Start the exact two retained UAT hosts after the October9 power pause and verify the original application is ready.
Decisions:
- API `i-0248e3a31d9b75ad1`; AI/workers `i-0ef193d594e475a65`; VPC `vpc-062e5bf61b966285d`.
- Preserve source, images, configuration, data and signed restoration evidence. This is a power resume, not a new release or customer-gate mutation.
- Use current instance/SSM identity with the enrolled private IPs and strict existing host keys; no public SSH or new key trust.
- UAT/READY/Production workflow IDs: `NOT_DISPATCHED`.
Open questions: none.
Artifacts: private `~/.codex/offline-restores/20261009-uat-resume/`.
Verification: cloud/V2/Kamal runbooks read. Fresh workflow inventory has zero executable release/recovery workflows; only the exact documented old metadata ghost is excluded. One StartInstances request started both stopped hosts; both independently running and SSM Online. Private addresses and existing SSH host keys match. The same three original container IDs/images/source/configurations passed the existing strict runtime validator and deep API/DB, AI, worker/Redis/internal-API readiness. Both ALB targets healthy; RDS/Redis available. Public UAT health/login200 and PlatformAccessOPEN; Production health200/OPEN. LINE UAT @234jrspv retains the configured endpoint and LINE's empty-event verification passes200. Both owned SSM sessions terminated successfully. Canonical target unchanged; no application deployment, database mutation or provider setting change.
Next: None. UAT is ready for use. A new real LINE conversation was not exercised during this power resume; the prior owner-confirmed successful conversation remains separate historical evidence.

## Current addresses and evidence

API private10.92.0.10/public13.212.240.142; AI/workers private10.92.0.42/public13.214.139.226.
Use enrolled SSM/private addresses; public IPs may change again after another stop/start.
Private `result.json` binds startup, host/runtime checks, transport cleanup, public/LINE verification
and workflow-idle evidence. Source remains `67c270d3cf5e46bff367d2e84e76f8efd6bb9e27`.
No temporary application resources were created. Runtime verification reused the existing controller's
strict host-key, exact-container/configuration and deep-health methods; the private helper's syntax
and all actual checks passed. Restored UAT EC2 compute charges resume while hosts run.
