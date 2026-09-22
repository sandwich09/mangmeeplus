# Agent Memory: kamal-ssm-host-identity-2026-09-22

Status: host reconciliation complete; UAT application rollout pending exact prepared build
Owner: Codex
Scope: permanent UAT/Production SSM host address and host-key reconciliation capability; no Production rollout
Decisions:
- SSM targets use stable primary private IPv4; public IPv4 is not deployment identity.
- Ordinary deployment stays fail-closed for host-key changes.
- A separate explicit reconciliation operation is the recovery path for an already enrolled instance; it cannot replace an instance identity.
Open questions:
- Why the clean UAT build exceeded its 240-second apply cap must not cause an unsafe retry: the supported recovery is a separate exact `--prepare` build followed by one `--prepared-build` apply.
Artifacts:
- `docs/specs/kamal-ssm-host-identity-spec.md`
- `docs/plans/kamal-ssm-host-identity-plan-2026-09-22.md`
Verification:
- `python3 infra/kamal/release_test.py` 37 passed; private-address rule, explicit key approval, no-write-on-cleanup-failure, and timeout process-group cleanup are covered.
- `python3 infra/kamal/release_paths_test.py` 8 passed; `python3 infra/kamal/stability_test.py` 5 passed.
- `infra/kamal/deploy-uat --help` exposes the reconciliation operation.
- UAT host reconciliation `20260922T104435Z-e8813d9a`: `HOST_IDENTITY_RECONCILED`; exact enrolled instance IDs and primary private addresses were retained.
- UAT preflight `20260922T104447Z-1f4824d6`: passed with SSM/private target.
- UAT apply `20260922T104512Z-08d85507`: failed at `main-typescript-build` after 257.683 seconds; `productionMutated=false`, no publication/deployment phase, and SSM cleanup terminated 2/2 sessions. Typecheck completed, but parallel complete image build exceeded the 240-second unprepared-build boundary.
Next: publish process-group timeout cleanup, run the exact main UAT `--prepare`, verify its build receipt, then run one UAT smoke deploy with that prepared build. Production has shared controller capability but is not deployed in this task.
