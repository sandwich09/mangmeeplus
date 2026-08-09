# Exact Object-Version Cleanup

Status: implementation plan

## Goal

Remove only the exact S3 versions created by an API request when the following database
finalization fails after the object write:

- immutable attachment finalization (`evidence/<companyId>/...`);
- report export creation (`report-export/<companyId>/...`);
- certified or issued substitute-receipt artifact creation
  (`<companyId>/generated/expense-substitute/...`).

The API must not receive `s3:DeleteObjectVersion`. Cleanup is durable work claimed from the
existing PostgreSQL outbox; the workers task performs the exact-version delete with a dedicated
prefix-scoped IAM policy.

## Contract

- The producer stores bucket, exact object path, exact version, company, and source in one
  idempotent HIGH-priority outbox row before returning the original finalization error.
- Cleanup events are excluded from the workflow-event drain and claimed only by the cleanup path.
- The worker independently rejects a bucket other than `S3_BUCKET`, a source/prefix mismatch,
  unsafe paths, or an absent/malformed exact version.
- `DeleteObject` is always sent with `VersionId`. `NoSuchVersion` is success, making retries safe.
- Success stores `PUBLISHED/publishedAt`; failures store bounded `lastError`, increment `attempts`,
  retry with existing backoff, and eventually park at `DEAD`.
- Claim-token fencing remains authoritative. A lost completion lease causes a harmless retry.
- Failure to persist the cleanup request emits a CRITICAL structured event but never replaces the
  request's existing user-facing error.

## Smallest architecture change

Reuse `OutboxEvent`, its atomic `SKIP LOCKED` claim, fencing token, retry counter, and DEAD state.
Add event-type filtering so the existing workflow drain cannot consume cleanup work. Workers keep
database ownership in the API: they claim and complete through worker-token endpoints, but call S3
directly under the workers task role.

No data-rights deletion endpoint and no general object purge operation are introduced.

## Verification

- API enqueue/claim/fencing/failure-path tests.
- Worker parser/delete/NoSuchVersion/retry tests.
- Production and UAT IAM contract tests proving the API lacks `DeleteObjectVersion` and the workers
  policy grants only that action on the three required prefixes.
- API and workers typechecks.
