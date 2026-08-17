# Agent Memory: production-deploy-2026-08-17

Status: In progress
Owner: Product owner / Codex
Scope: Promote the accepted LINE AI release through UAT, signed READY and Production without changing application TypeScript.
Decisions:
- Hosted concurrency is deferred under `OWNER-DIRECTIVE-2026-08-17-LINE-AI-CONCURRENCY-DEFERRED`; the release remains conditional and the deferred test must still be performed after opening.
- Do not run the TypeScript suite for release/security-only changes. Merge the reviewed change under the owner's admin-bypass authorization, restore branch protection, then create an empty release checkpoint whose CI proves `code_changed=false` and skips TypeScript.
- AWS ECR currently maps `CVE-2026-14456` to Debian source package `openssl` `3.0.20-1~deb12u2`, while its own description says the issue begins with OpenSSL 3.5 QUIC server support. Use only the exact, expiring, digest-recording exception in `infra/docker/ecr-scan-blocking-findings.jq`; all other HIGH/CRITICAL findings remain fail-closed.
Open questions:
- None for the current UAT dispatch. Customer `OPEN` and deferred concurrency remain post-promotion state transitions.
Artifacts:
- Failed UAT runs: `32004507684`, `32007029995`, `32007856084`.
- Initial affected runnable digests: api-web `sha256:f9b5cf18a53487487e823a7e1e443359e0a7eaef4c953e26f1f2bdc970ecfc63`; release-task `sha256:b89651b3b19cbc00a3bd9bf1ddfb545bf04a1db198f6d9d29f0f6d3b8fb56dc7`.
- Previous image hardening commits: `3c6cccfaabff86810db7fd0ee6ac5eace9f181b2`, `0c046a90bb38935e386022d87d3f8d5d279b7b4d`.
- Last successful no-TypeScript CI: `32007755936`; prior release checkpoint `9ec9f59889c6c939959d453e6cac77beaee313aa`.
Verification:
- `bash infra/docker/ecr-scan-blocking-findings.spec.sh` passes.
- `bash infra/security/production-security-preflight.spec.sh` passes, including accepted exact waiver and rejected forged waiver.
- Live AWS scan JSON for api-web runnable digest is fully covered (1 raw HIGH, 1 exact waiver, 0 blocking); `infra/docker/verify-ecr-scan.sh` passes that digest.
Next:
- Commit, review and merge the exact waiver policy; create a no-code release checkpoint; run one UAT; then follow A5 reader bootstrap, signed READY, Production promotion and customer OPEN in the mandatory deployment runbook.
