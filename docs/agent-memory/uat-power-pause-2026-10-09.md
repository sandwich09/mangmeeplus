# Agent Memory: UAT power pause — 2026-10-09

Status: COMPLETED — UAT_POWER_PAUSED
Subsequent state: owner requested “เปิด uat”; both hosts resumed and verified ready at19:47Bangkok. See [power-resume evidence](uat-power-resume-2026-10-09.md). The pause result below remains historical.
Owner: primary agent, following owner request “ปิด uat ก่อน”.
Scope: Reversible power pause of the two restored UAT Kamal hosts. Retain application/data volumes, RDS, Redis, S3, routing and provider configuration for reopening.
Decisions:
- Follow the established UAT power-pause procedure in the cloud runbook; this is not a deployment or durable customer-gate change.
- Stop only API `i-0248e3a31d9b75ad1` and AI/workers `i-0ef193d594e475a65` in `vpc-062e5bf61b966285d`, with normal OS shutdown and no force/termination.
- Retained RDS, Redis, ALB and storage continue to incur charges; no zero-cost claim. Production stays running.
- UAT/READY/Production workflow IDs: `NOT_DISPATCHED`; signed restoration evidence stays unchanged.
Open questions: none.
Artifacts: private `~/.codex/offline-restores/20261009-uat-pause/`.
Verification: canonical target, UAT environment tags/VPC and exact host identities agree; no Auto Scaling membership or active UAT deployment guard. Fresh workflow inventory has zero executable releases; the exact documented August12 metadata ghost remains unchanged. One StopInstances request succeeded (request ID `decdd9ab-4994-435f-ac43-24ecd25ac012`, zero retries) under the deployment lock. Both UAT hosts independently read back stopped, without public IPs and with EBS volumes retained. Canonical target bytes unchanged. All four Production hosts remain running; public health200 and PlatformAccessOPEN pass. Public UAT health returns504 after power-off.
Next: None for shutdown. Before reopening, start these exact retained hosts, recheck current addresses/SSM identity and API/AI/workers readiness, then confirm public health/OPEN. Do not reuse former public IPs.

## Evidence limits and local corrections

Private `result.json` binds the preflight, single accepted stop, terminal state and Production readback.
The existing owner profile was used for the exact stop, consistent with prior power-pause operations;
no IAM change was made. Two local SDK configuration attempts failed before client creation/API calls;
the installed SDK validator was inspected and its supported `max_attempts:1` used. The public probe
initially expected503 too narrowly; it observed504, consistent with the stopped origin. This was
recorded without repeating the probe or any cloud mutation. Signed restoration evidence is unchanged.
