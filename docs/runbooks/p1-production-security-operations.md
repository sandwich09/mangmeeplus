# P1 Production Security Operations Runbook

## Scope and owners

- Platform on-call: CloudWatch retention/KMS, alarms, Redis/RDS recovery.
- Security owner: alert routing, vulnerability exceptions, secret revocation.
- DPO/privacy owner: post-restore re-erasure evidence and processor register.
- Release manager: immutable artifact, ECR scan, provenance, SBOM, rollback.

Production identifiers and notification/KMS targets are environment-owned values;
they must not be committed as credentials.

## M-16 deployment and alert evidence

The production deploy fails before rollout unless `LOG_KMS_KEY_ID` and
`SECURITY_ALERT_TOPIC_ARN` are set. Each production application log group receives 14-day
retention, the classified KMS key, a high-risk security metric filter, and an
alarm routed to that topic.

After deployment:

1. Run `infra/security/verify-production-security-baseline.sh` with read-only AWS
   credentials and archive the sanitized output.
2. Emit an authorized synthetic high-risk JSON event with a unique request id.
3. Record the CloudWatch log event, alarm transition, notification delivery,
   acknowledgement by the named on-call owner, and the reconstruction chain.
4. Do not close M-16 if a destination has no human owner or delivery was not
   observed.

## M-17 RDS/Redis recovery

The verifier requires encrypted Multi-AZ RDS, deletion protection, 35-day backup
retention, and encrypted/authenticated Redis with automatic failover, at least
two nodes, and 35-day snapshots. A maintenance change must create/replace Redis
rather than weakening TLS/auth to preserve an incompatible legacy node.

Quarterly restore drill:

1. Restore into isolated subnets/security groups; do not route production traffic.
2. Record backup timestamp, restore start/finish, measured RTO/RPO, integrity
   checks, and application smoke results.
3. Set `INTERNAL_API_URL`, `WORKER_INTERNAL_TOKEN`, and
   `RESTORED_SNAPSHOT_AT`; run `infra/security/post-restore-re-erasure.sh`.
4. Verify completed erasure cases at or before the restored snapshot were
   requeued and re-erased, AI/CRM retention purge is empty, and retained legal
   exceptions remain explicit.
5. Destroy the isolated restore only after evidence export and approval.

## Secret rotation/revocation

Inventory every production secret by type and owner. For each rotation record
old/new version ids (never values), consumer rollout order, verification,
revocation time, rollback window, and approver. Use automatic rotation where the
consumer supports it; otherwise use dual-key deployment, verify all consumers,
then revoke the old version. A changed timestamp without consumer verification
and old-version revocation is not closure evidence.

## M-18 supply-chain release

CI pins action/base-image identities, uses the frozen lockfile and explicit
lifecycle-script allowlist, audits all shipped build/runtime dependencies,
generates SBOM and max-mode provenance, and rejects final ECR artifacts with
Critical or High findings. Any exception must name the exact digest/CVE,
reachability evidence, compensating control, approver, and expiry; it must not
silently lower the gate.

### Temporary ECR base-image exceptions

`infra/docker/ecr-scan-blocking-findings.jq` is the compensating control and the
only place a HIGH/CRITICAL finding may be waived. Each row requires the exact CVE,
severity, source package, version and a provider statement copied verbatim from the
advisory; it binds every emitted waiver to the exact scanned digest, carries an
owner approval id and an expiry epoch, and fails closed when detailed findings do
not cover the provider's aggregate HIGH/CRITICAL count. Every other HIGH/CRITICAL
finding remains blocking. `e0_ecr_waiver_rows` in
`infra/security/evidence-contracts.jq` holds the identical rows for production
promotion — the two must match field for field, or UAT passes and promotion is
refused. The Production Security Preflight retains the raw provider counts and
embeds the digest-bound waiver in signed evidence.

Delete an exception when the provider corrects the mapping or stops reporting the
finding; extending an expiry requires new evidence and a NEW explicit approval id,
never a reused one. Every issue, renewal and retirement gets a row in the waiver
ledger in `docs/runbooks/cloud-environment-operations.md` §7 ("ECR scan gate — CVE
ใหม่ใน base image"), which is the authoritative list of what is waived, until when,
and on whose approval.

Current state (2026-09-05): five rows — CVE-2026-54874, CVE-2026-63072 and
CVE-2026-63076 (HIGH, `openssl 3.0.20-1~deb12u2`), CVE-2026-75803 (CRITICAL, same
package) and CVE-2026-85091 (HIGH, `zlib 1.2.13.dfsg-1`) — all expiring
`1791158400` (2026-10-05T00:00:00Z) under
`CHAT-OWNER-DIRECTIVE-2026-09-05-CVE-WAIVER-RENEWAL-2026-10-05`. The earlier
CVE-2026-14456 OpenSSL-3.5-QUIC mapping exception was retired the same day: ECR no
longer reports it and Debian records bookworm openssl as not-affected, so the row
was deleted rather than renewed and the finding blocks again if it returns.
