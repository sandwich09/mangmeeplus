# Agent Memory: UAT power pause — 2026-10-10

Status: COMPLETED — UAT_POWER_PAUSED
Owner: primary agent following owner request “ปิด uat”.
Scope: Reversible stop of UAT API `i-0248e3a31d9b75ad1` and AI/workers `i-0ef193d594e475a65`; keep data and remaining infrastructure for reopening.
Decisions:
- Follow the established UAT power-pause procedure: normal OS shutdown, no force, termination, database deletion or customer-gate change.
- RDS, Redis, ALB and storage remain billable. Production is outside the mutation scope.
- UAT/READY/Production workflow IDs: `NOT_DISPATCHED`; signed restoration evidence unchanged.
Open questions: none.
Artifacts: private `~/.codex/offline-restores/20261010-uat-pause/`.
Verification: exact canonical host IDs, UAT tags and restored VPC match; no Auto Scaling membership or active UAT deployment guard. Fresh workflow inventory has zero executable releases; only the exact documented old metadata ghost is excluded. One normal StopInstances request succeeded under the deployment lock, with zero retries. Both UAT hosts independently read back stopped without public IPs; EBS volumes retained and canonical target bytes unchanged. All four Production hosts running, public health200 and PlatformAccessOPEN. Private result.json binds all verification evidence. No failure, deployment or IAM/provider setting change.
Next: None for shutdown. Before reopening, start these exact retained hosts and verify current IP/SSM/host identity, deep API/AI/workers readiness and public OPEN; former public IPs are stale.
