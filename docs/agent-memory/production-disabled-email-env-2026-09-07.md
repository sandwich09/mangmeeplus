# Agent Memory: production-disabled-email-env-2026-09-07

Status: Root cause reproduced; minimal controller fix passes all mandatory local checks, ready for PR/CI.
Owner: thawatchai / MangmeeDev
Scope: Let the exact UAT candidate boot on Production while outbound email remains disabled.
Decisions: Owner authorized Production feature parity and deferred email. Wire `SES_FROM_ADDRESS` from the Production environment variable with the existing UAT sender as fallback. Keep `EMAIL_PROVIDER=disabled` and the SES activation rejection. No application/image/migration or IAM change.
Open questions: None about the fix. Release recovery must reach a proved terminal state before another READY or promotion.
Artifacts: Failed Production run `34072334980` attempt 1; UAT `34068520561`; live READY `34071132693`; candidate `604ac785479ced5b9858d0b46d89f8d11cf2b9f6`; failed controller `255c889917e3c56511fdff562c36e605c72ecc98`.
Verification: API task definition `watchdog-bms-prod-watchdog-bms-api-web-pub:211` exits during config validation because the deploy script emits an empty optional email field. Reproduced using its plaintext environment and schema-valid surrogate secret values: the only failing schema key is `SES_FROM_ADDRESS`. Setting only `contact@mangmeeplus.com` passes `apiConfigSchema` and `validateProductionConfig`; provider remains `disabled`. No runtime secret values were read for this probe. Pin synchronization and whitespace validation pass. Full `bash infra/docker/production-image-security.spec.sh` PASS (exit 0), including all 26 Prisma migration/clone/apply tests, after installing locked dependencies and generating the new worktree's Prisma client and contracts. Existing UAT Passport passes the canonical validator from this controller checkout.
Next: Complete checks and normal PR/CI integration. Keep main frozen while the failed release is unresolved. Capture its final controller evidence and prove platform/database terminal state before new READY on the reviewed controller; reuse the existing signed Passport only if the canonical validators accept it.

## Failure boundary

The failed step is `Close the exact candidate before any Production database mutation`. The durable release operation identity and migration preparation steps were skipped. The workflow's built-in closed-candidate recovery is still running; no external recovery, cancel or retry was dispatched. Production release completion is not claimed.

The workflow-level environment covers both the initial maintenance close, built-in recovery and final live rollout. It restores the missing controller input without changing the tested application schema or immutable image digests. A valid sender alone does not enable email or grant SES permissions.
