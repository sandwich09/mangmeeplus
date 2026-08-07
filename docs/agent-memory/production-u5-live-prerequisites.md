# Agent Memory: production U5 live prerequisites

Status: IN PROGRESS at 2026-08-04 handoff; live state inspected read-only, no production mutation.
Canonical handoff: `docs/agent-memory/feature-entitlement-u5-production-handoff.md`.
Owner: Production U5 promotion task.
Scope: AWS/GitHub prerequisites that must be true before the approved shadow-only release can mutate
production.
Decisions:

- `main` is production and `develop` is UAT.
- Production promotion is shadow-only: it does not infer VAT/WHT statutory acceptance, human
  usability, accessibility or per-family enforcement. WHT launch routes remain CLOSED.
- Never recover the currently stopped legacy api-web merely to satisfy a health preflight. The
  reviewed bridge rollout itself must establish minimum capacity with
  `REIMBURSEMENT_WRITE_QUIESCE=true`; all unguarded tasks retire before any migration.
- The single-use AWS callback is not stored or replayed. The isolated thawatchai/root session was
  confirmed against account `311414082667` and is used only for narrow reviewed bootstrap/readback.
- Do not fetch or expose runtime secret values. Production Redis was identified from secret metadata
  only.

Open questions:

- Owner must name and confirm the human destination for `SECURITY_ALERT_TOPIC_ARN`; synthetic
  delivery and acknowledgement are required.
- Owner must approve the added cost/availability change for RDS Multi-AZ plus 35-day backup and
  deletion protection.
- Owner must approve provisioning/migrating to encrypted authenticated two-node managed Redis with
  automatic failover and 35-day snapshots, or explicitly change the normative production baseline.
- Protected `main` still requires a real independent collaborator approval; the automation must not
  weaken branch protection or self-approve.
- Owner must approve the recurring VPC PrivateLink endpoints needed for endpoint-only A5 tasks.
- A repo-scoped fine-grained `PRODUCTION_POLICY_READ_TOKEN` (Administration read-only) or equivalent
  GitHub App credential is still required for independent protected-branch policy evidence.

Artifacts:

- `.github/workflows/deploy-production.yml`
- `.github/workflows/production-security-preflight.yml`
- `infra/security/verify-production-security-baseline.sh`
- `docs/runbooks/p1-production-security-operations.md`
- `docs/specs/reimbursement-upgrade-write-quiesce-spec.md`

Verification:

- AWS identity: account `311414082667`, thawatchai root session (sanitized caller identity only).
- Production ECS Express resources are ACTIVE but all three services have minimum capacity zero and
  no running task; public health is 503.
- Production RDS is encrypted PostgreSQL 18.3, but readback showed single-AZ, backup retention 7 and
  deletion protection disabled.
- No ElastiCache replication group/serverless cache and no SNS topic exist in
  `ap-southeast-1`; a `watchdog-bms/production/redis-url` secret exists but its value was not read.
- Production api-web live environment does not yet state `CLAMAV_HOST`; exact candidate UAT clean
  and EICAR evidence must precede setting `127.0.0.1` on the matching image.

Next:

- Freeze A5/U5/reimbursement bytes, run adversarial tests, then bootstrap only the exact missing IAM
  readers/controller policy from reviewed templates.
- Obtain the three owner/security/cost decisions above before infrastructure mutation.
- Land and deploy the old-schema-compatible bridge through protected `main`, then run the private
  clone/A5 chain and final production wave.
- Treat all controller/network scripts currently in the dirty worktree as unaccepted until their
  complete state-machine, endpoint-policy, migration-tool and adversarial suites pass on frozen
  bytes.
