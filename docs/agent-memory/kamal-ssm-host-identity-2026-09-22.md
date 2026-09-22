# Agent Memory: kamal-ssm-host-identity-2026-09-22

Status: implementation complete locally; UAT reconciliation/deployment pending
Owner: Codex
Scope: permanent UAT/Production SSM host address and host-key reconciliation capability; no Production rollout
Decisions:
- SSM targets use stable primary private IPv4; public IPv4 is not deployment identity.
- Ordinary deployment stays fail-closed for host-key changes.
- A separate explicit reconciliation operation is the recovery path for an already enrolled instance; it cannot replace an instance identity.
Open questions:
- Current UAT host-key rotation provenance remains to be recorded in the reconciliation receipt; deploy-role access cannot read EC2 UserData.
Artifacts:
- `docs/specs/kamal-ssm-host-identity-spec.md`
- `docs/plans/kamal-ssm-host-identity-plan-2026-09-22.md`
Verification:
- `python3 infra/kamal/release_test.py` 36 passed; private-address rule, explicit key approval, and no-write-on-cleanup-failure are covered.
- `python3 infra/kamal/release_paths_test.py` 8 passed; `python3 infra/kamal/stability_test.py` 5 passed.
- `infra/kamal/deploy-uat --help` exposes the reconciliation operation.
Next: commit/publish the controller, reconcile the current UAT target with owner-approved key rotation, then use one UAT smoke deployment. Production receives the shared controller capability but is not deployed in this task.
