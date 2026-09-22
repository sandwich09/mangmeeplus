# Plan: permanent Kamal SSM host identity

Status: implemented and locally verified; UAT reconciliation/deployment pending

## Smallest correct change

1. Centralize the host-identity predicate in `infra/kamal/release.py` and require a private address whenever SSM is selected; retain the direct-SSH behavior unchanged.
2. Add an explicit, local-only `reconcile-host-identity` command for an already enrolled UAT or Production target. Reuse the release target validation, scoped AWS profile, SSM tunnels, and atomic private-file writes; do not add dependencies or cloud writes.
3. Require a deliberate key-rotation flag and reason, create a private result receipt, and preserve strict host-key checks in ordinary release.
4. Add focused synthetic tests, update target-enrollment/runbook guidance, and record the UAT recovery. Do not touch unrelated sales/billing worktree changes.

## Non-goals

- No automatic acceptance of unknown host keys.
- No production application deployment, target bootstrap, IAM expansion, public SSH ingress, Elastic IP, or CloudFormation change.
- No replacement-instance discovery: replacing an instance remains enrollment work because it changes the trust boundary.

## Verification

- `python3 infra/kamal/release_test.py` — 36 passed.
- `python3 infra/kamal/release_paths_test.py` — 8 passed.
- `python3 infra/kamal/stability_test.py` — 5 passed.
- `infra/kamal/deploy-uat --help` exposes the explicit reconciliation operation and does not make a cloud change.
- After merge, reconcile the current UAT target with the owner-approved rotation, then run exactly one UAT smoke deploy under the mandatory protocol.
