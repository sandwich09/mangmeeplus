# Agent Memory: production A5 v2

Status: Local implementation complete; commit/PR review and live proof pending
Owner: Codex / release owner
Scope: Replace the circular A5/U5 Production ceremony with a signed UAT Release Passport V2,
precomputed Production Readiness V2 and a minimal exact-image promotion.

Decisions:

- UAT remains the only place that runs source CI and builds/signs application release images.
- A resolved-all UAT emits one signed passport containing runtime, release-task and migration-tool
  digests, SBOM/signature evidence, migration catalog and UAT acceptance facts.
- Requested `auto` uses the strict Production-eligible controller checks before target resolution;
  only the later resolved target controls selective image publication/deployment.
- Production readiness is read-only against live Production. No pending migration is the quick
  path; a pending append-only suffix uses the exact UAT migration-tool on a private clone.
- Known destructive pending SQL is forbidden from automatic promotion and is checked when
  classifying the ledger, in clone rehearsal and inside the durable Production DB fence.
- Production deploy accepts only an unexpired signed READY whose controller and active baseline
  still match. It does not build, typecheck, test, generate SBOM or sign application images.
- Candidate application bytes come from the accepted source; security/controller bytes come from
  protected `github.workflow_sha` on main.
- Selective deployment fails safe to all. Current split Production baseline requires the first V2
  convergence release to target all.
- OPEN→CLOSED drains signed URLs once for 900 seconds; CLOSED→CLOSED proves continuous closure and
  does not repeat the drain.
- Failed closed-stage rollout recovers the exact UAT candidate in maintenance mode, proves it, then
  reports the requested promotion as failed instead of silently succeeding/opening.
- Technical closed deployment and customer-live legal approval remain separate. Keep one explicit
  owner promotion action after READY.
- One-time A5 bootstrap authority is administrator-created and self-revokes after any attempt. The
  workflow cannot re-arm itself; normal readiness uses the durable read-only role afterward.
- Release-tool ECR tags include workflow run and attempt, so rerunning the same source cannot collide
  with the immutable migration-tool repository; every downstream contract still binds the digest.
- Infra contract specs use runner-standard `grep -E`, not workstation-only `rg`; the consolidated
  suite is verified with an exported failing `rg` shim to prevent this portability regression.
- Consolidate into one reviewed change; do not return to a sequence of blocker-fix PRs.

Open questions:

- Independent approval of the V2 trust boundaries and one-click-after-READY promotion boundary.
- Exact first-green timings for UAT Passport, live quick readiness and A5 restore/rehearse/cleanup.
- Counsel/privacy-owner evidence before `PROMOTED_LIVE`; current legal manifest remains blocked.

Artifacts:

- `docs/specs/production-a5-v2-spec.md`
- `docs/plans/production-a5-v2-readiness-matrix.md`
- `docs/plans/production-a5-v2-plan.md`
- `.github/workflows/production-a5-reader-bootstrap.yml`
- `.github/workflows/production-readiness.yml`
- `.github/workflows/deploy-production-v2.yml`
- `infra/security/validate-uat-release-passport-v2.sh`
- `infra/security/validate-production-release-ready-v2.sh`
- `infra/security/validate-production-release-result-v2.sh`
- `docs/runbooks/production-a5-u5-promotion-ceremony.md` (V1 frozen reference)

Verification:

- Full `infra/docker/production-image-security.spec.sh` passes, including Passport, artifact
  extraction, readiness, READY, baseline, clone, deploy/result/recovery, serving mode, maintenance,
  release-safety, security preflight and A5 bootstrap contracts.
- API migration classification/DB-fence tests pass 4/4 and API typecheck passes, including
  destructive SQL negative cases.
- Critical workflow YAML parses, changed shell/JSON syntax and maintenance pins pass; `git diff
  --check` passes after the repeat-safe immutable ECR tag fix.
- PR CI run `31538531091` exposed missing `rg` on GitHub Ubuntu; all four remaining infra-spec
  dependencies were removed and the full security suite passes while `rg` is forced to exit 127.
- PR #37 merged as `cbd87fdef73cf1f503e0a8e70fbc22222ab1b801`; all three administrator
  bootstrap controllers completed with exact read-back and the temporary administrator group was
  removed. First V2 UAT run `31551394010` reused CI and published all runtime images, then stopped
  before UAT mutation because the reusable workflow incorrectly tested `github.event_name` for
  `workflow_call` and skipped the required release-tools artifact. The controller now binds the
  required `source_ref` input instead, with a focused regression assertion.
- Read-only audit from the design phase found existing A5 network/clone resources and Production
  RDS/Redis baselines, but the A5 read-only DB secret is still absent.
- Production active source was split between API/AI and workers at audit time, so the first V2
  release remains all-target.
- No workflow dispatch, UAT/Production deploy, PR merge or cloud mutation was performed in this
  implementation turn.

Next:

1. Merge the reusable-workflow event-semantics correction after focused/full controller checks.
2. Run one resolved-all UAT to mint Passport V2, then dispatch the one-time reader bootstrap.
3. Let automatic closed-mode Production Readiness run; require quick READY or first-green A5 clone.
4. Owner explicitly dispatches one `maintenance_closed` Production V2 promotion.
5. Keep customer launch closed until independent legal evidence is complete.
