# Plan: permanent Kamal SSM host identity

Status: UAT host reconciliation passed; application rollout pending after a pre-mutation build timeout

## Smallest correct change

1. Centralize the host-identity predicate in `infra/kamal/release.py` and require a private address whenever SSM is selected; retain the direct-SSH behavior unchanged.
2. Add an explicit, local-only `reconcile-host-identity` command for an already enrolled UAT or Production target. Reuse the release target validation, scoped AWS profile, SSM tunnels, and atomic private-file writes; do not add dependencies or cloud writes.
3. Require a deliberate key-rotation flag and reason, create a private result receipt, and preserve strict host-key checks in ordinary release.
4. Add focused synthetic tests, update target-enrollment/runbook guidance, and record the UAT recovery. Do not touch unrelated sales/billing worktree changes.
5. Keep the existing 240-second unprepared-UAT-build boundary. Start each bounded local command in a process group and terminate the whole group on timeout. For a candidate that exceeds this boundary, run the existing read-only `--prepare` path and allow apply to reuse only its exact validated build.

## Non-goals

- No automatic acceptance of unknown host keys.
- No production application deployment, target bootstrap, IAM expansion, public SSH ingress, Elastic IP, or CloudFormation change.
- No replacement-instance discovery: replacing an instance remains enrollment work because it changes the trust boundary.

## Verification

- `python3 infra/kamal/release_test.py` — 37 passed.
- `python3 infra/kamal/release_paths_test.py` — 8 passed.
- `python3 infra/kamal/stability_test.py` — 5 passed.
- `infra/kamal/deploy-uat --help` exposes the explicit reconciliation operation and does not make a cloud change.
- UAT reconciliation `20260922T104435Z-e8813d9a` passed and UAT preflight `20260922T104447Z-1f4824d6` passed.
- First UAT apply `20260922T104512Z-08d85507` stopped before mutation at 257.683 seconds because its unprepared complete build exceeded the 240-second boundary. Its SSM cleanup passed; no image was published or container/database/customer state changed.
- After merge, run the exact main `--prepare` path, then use its verified `build/` directory for one UAT smoke apply.
