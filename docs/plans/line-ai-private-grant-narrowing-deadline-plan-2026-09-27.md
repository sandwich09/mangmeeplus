# Plan: LINE AI private grant narrowing deadline

Status: approved for scoped implementation
Date: 2026-09-27
Spec: [LINE AI private grant narrowing deadline](../specs/line-ai-private-grant-narrowing-deadline-spec-2026-09-27.md)

1. Change only the private grant narrowing transition to authenticate and copy deadlines from durable stored authority, while retaining existing profile, slot, cursor, signature, owner, and CAS gates.
2. Refuse both first and repeated narrowing at the stored work deadline, and expose that exact durable cause as `DEADLINE_EXCEEDED` through the two webhook narrowing paths.
3. Add deterministic clock and real PostgreSQL tests for the former plus-7-second cliff, stored-deadline trust, idempotent replay, true expiry, unchanged counts/cost fencing, and the typed customer outcome.
4. Run the focused budget/general tests against the existing isolated delivery-integrity database, then API typecheck and diff validation. Root reviews the combined diff before freeze; no independent commit of shared webhook code.

Out of scope: recalculating from route-decision time, extending an issued deadline, resetting on retry, changing public-general or QA deadlines, adding flags/dependencies/schema, package/permission changes, live providers, cloud operations, deployment, push, or merge.
