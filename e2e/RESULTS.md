## E2E Run 2026-07-09T16:32:52Z — 5c5fc54
Environment: web :3000 / api :3001 / db :5432 (seeded) / redis down / minio down
Command: e2e/run-local.sh
Result: 89 passed, 1 failed, 1 quarantined, 2 skipped   (P0 28/28, P1 58/58, P2 4/6 implemented passed; 21 remaining P2 catalog cases deferred by stop condition)

### Failures
- (none) — the sole failure ACCT-05 / BUG-1 was fixed; full accounting suite re-run 5/5 green.

### Quarantined
- EXP-06 — receipt upload requires MinIO/object storage in this local run — blocking dependency MinIO/S3

### Bugs filed
- BUG-1 — ACCT-05 accepts zero-line accounting document issue — `POST /companies/:id/accounting/documents/:documentId/issue` — expected 400/422; was 200 OK.
  **FIXED 2026-07-09:** added `validateIssuableLines()` guard in `accounting-status.logic.ts`, wired into `IssueDocumentUseCase` (now throws `UnprocessableEntityException` → 422). Unit test added; `e2e/run-local.sh e2e/accounting.spec.ts` → 5/5 passed.
