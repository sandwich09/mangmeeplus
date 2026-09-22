# Agent Memory: kamal-ssm-host-identity-2026-09-22

Status: UAT rollout accepted and public OPEN; Production controller capability delivered, no Production rollout
Owner: Codex
Scope: permanent UAT/Production SSM host address and host-key reconciliation capability; no Production rollout
Decisions:
- SSM targets use stable primary private IPv4; public IPv4 is not deployment identity.
- Ordinary deployment stays fail-closed for host-key changes.
- A separate explicit reconciliation operation is the recovery path for an already enrolled instance; it cannot replace an instance identity.
- UAT applies reuse a separately validated exact build when the bounded unprepared-build path would otherwise time out.
- One SSM transport snapshots one deploy-role credential session for both start and terminate, preserving own-session IAM scope.
Open questions:
- Production uses the shared controller rules but was not enrolled, reconciled, or deployed in this UAT hotfix task.
Artifacts:
- `docs/specs/kamal-ssm-host-identity-spec.md`
- `docs/plans/kamal-ssm-host-identity-plan-2026-09-22.md`
Verification:
- `python3 infra/kamal/release_test.py` 38 passed; private-address rule, explicit key approval, no-write-on-cleanup-failure, timeout process-group cleanup, and one credential session through SSM cleanup are covered.
- `python3 infra/kamal/release_paths_test.py` 8 passed; `python3 infra/kamal/stability_test.py` 5 passed.
- `infra/kamal/deploy-uat --help` exposes the reconciliation operation.
- UAT host reconciliation `20260922T104435Z-e8813d9a`: `HOST_IDENTITY_RECONCILED`; exact enrolled instance IDs and primary private addresses were retained.
- UAT preflight `20260922T104447Z-1f4824d6`: passed with SSM/private target.
- UAT apply `20260922T104512Z-08d85507`: failed at `main-typescript-build` after 257.683 seconds; `productionMutated=false`, no publication/deployment phase, and SSM cleanup terminated 2/2 sessions. Typecheck completed, but parallel complete image build exceeded the 240-second unprepared-build boundary.
- UAT prepare `20260922T105644Z-8039fbc1`: build/config/storage/freshness passed for `b7a9919a…` in 212.354 seconds, but `FAILED_TRANSPORT_CLEANUP_REQUIRED` before deployment. The deploy profile refreshed to a different STS session before `TerminateSession`, which existing own-session IAM correctly denied. Owner closed only the two exact controller sessions; no application mutation occurred.
- UAT prepare `20260922T110517Z-e5d0e109`: `PREPARED_NO_DEPLOYMENT` for exact main `d67d69d3ca2224bcbc7f7e6c070bd9d5cba3f18b`; all five phases passed in 107.258 seconds and SSM cleanup terminated 2/2 sessions.
- UAT apply `20260922T110739Z-ed3c91e5`: `ACCEPTED_LINE_DEFERRED` in 230.119 seconds; all 11 phases passed, KMS ECDSA signature verified, AgentCore `kamal_uat_b` version 22 pinned to exact source, public platform access is `OPEN`, and SSM cleanup terminated 2/2 sessions with no active deployment remaining. UAT/READY/Production workflow IDs: `NOT_DISPATCHED`.
Next: retain the signed UAT receipt and use the normal separate Production protocol only when a Production release is explicitly requested.
