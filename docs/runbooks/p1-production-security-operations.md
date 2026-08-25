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

### Temporary ECR mapping exception: CVE-2026-14456

Until `2026-08-27T00:00:00Z`, release scanning may waive only the exact AWS ECR
finding `CVE-2026-14456`, severity `HIGH`, source package `openssl`, version
`3.0.20-1~deb12u2`, when the provider description contains its own statement that
the issue is present since OpenSSL 3.5 when QUIC server support was added. The
scanned 3.0.20 package predates that implementation; this is provider reachability
evidence, not a general CVE bypass. Initial observations were runnable digests
`sha256:f9b5cf18a53487487e823a7e1e443359e0a7eaef4c953e26f1f2bdc970ecfc63`
and `sha256:b89651b3b19cbc00a3bd9bf1ddfb545bf04a1db198f6d9d29f0f6d3b8fb56dc7`.

`infra/docker/ecr-scan-blocking-findings.jq` is the compensating control. It
requires the exact CVE, severity, package, version and provider statement, binds
each emitted waiver to the exact scanned digest, records owner approval
`CHAT-OWNER-DIRECTIVE-2026-08-25-EXTEND-TO-2026-08-27` and expiry `1787788800`, and
fails closed when detailed findings do not cover the provider's aggregate
HIGH/CRITICAL count. Every other HIGH/CRITICAL finding remains blocking. The
Production Security Preflight retains the raw provider counts and embeds the
digest-bound waiver in signed evidence. Delete the exception when AWS corrects
the mapping or before extending the expiry; an extension requires new evidence
and explicit approval.

Owner renewed this exact exception on 2026-08-25 after UAT run `32829457833`
attempt 2 reproduced the same provider mapping on fresh image digests. OpenSSL's
vendor advisory still lists affected versions as 3.5.0+, while the scanned
Debian source package remains 3.0.20; the renewal does not match any other CVE,
severity, package, version or provider statement.
