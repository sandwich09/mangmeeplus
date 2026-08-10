# Agent Memory: UAT deploy 2026-08-10

Status: In progress
Owner: Codex with MangmeeDev operator session
Scope: Recover the stale UAT release operation, deploy `7e69a5e164d69ce5425add99adf53bf3e74bcb13`, and bring all UAT ECS Express services from capacity `0/0` to the workflow default `1/2`.
Decisions: Use the GitHub controllers from `main`; do not deploy from the workstation. Run #4 failed before its first durable service intent because the deploy role lacked `iam:GetRolePolicy` on the UAT workers role. Use `PRE_INTENT` recovery, not generic reconciliation. Replace the unreachable pre-import UAT recovery floor with initial import `668a2d0827921257d6412a5edc0598d5aeb9a0fa`, which already contains the reviewed recovery implementation.
Open questions: None.
Artifacts: UAT Deploy runs `31340979197` and `31343445587`; stale operation `619c3bc5-d452-4501-af10-92b353b7d964`; original task `cfcc514610ab450cadcc8e81130c18ba`; failed recovery run `31343260571`.
Verification: Before recovery, all three UAT services were `ACTIVE` at capacity `0/0`, no tasks were running, RDS and Redis were available. CloudWatch stream `release/release/cfcc514610ab450cadcc8e81130c18ba` proves migrations/sync completed and the operation entered rollout hold without a service deployment. Focused checks and final deployment evidence pending.
Next: Verify the controller fix, move it through `develop` and neutral `main`, run `PRE_INTENT` recovery without the expired parent-task input, dispatch UAT Deploy for `7e69a5e164d69ce5425add99adf53bf3e74bcb13`, and verify workflow, digests, capacity, and health.
