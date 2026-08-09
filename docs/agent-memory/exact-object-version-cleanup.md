# Agent Memory: Exact Object-Version Cleanup

Status: implementing
Owner: data-rights-service agent
Scope: failed immutable object writes, durable outbox cleanup, workers exact-version deletion, production/UAT IAM
Decisions: reuse fenced `OutboxEvent`; workers claim via internal API and delete S3 directly; no API `DeleteObjectVersion`
Open questions: production alarm/rerun evidence for DEAD cleanup rows remains an operational prerequisite
Artifacts: `docs/plans/exact-object-version-cleanup-plan.md`
Verification: pending
Next: implement API queue boundary, worker handler, and IAM contract
