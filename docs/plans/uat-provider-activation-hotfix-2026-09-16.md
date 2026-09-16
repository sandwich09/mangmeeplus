# UAT provider activation hotfix — 2026-09-16

Status: COMPLETE for the three scoped fixes: implemented, exact-commit full CI passed, merged develop/main, deployed and native Postmark/Redis acceptance passed. Billing activation remains a separate authenticated-actor dependency. Scope: native acceptance gaps found after main8c277dea deployed successfully. Existing billing/passwordless specs remain authoritative; no product policy change.

## Native failures and required behavior

1. Postmark webhook25832029 verification reaches the real UAT endpoint with correct BasicAuth, but all three probes receive400 environment mismatch. Actual provider UI shows reserved all-zeroMessageID, recipientjohn@example.com, streamoutbound; Delivery usesServerID23, Bounce/SpamComplaint useServerID1234. These are synthetic verification probes, not real UAT delivery events. After authenticating and parsing, acknowledge only this narrow observed probe shape with200 and NO outbox, audit delivery mutation, suppression or customer state. Real events retain exact configured server/stream checks and durable enqueue/deduplication. Invalid authentication/shape and near-match foreign events still reject. Retain native failure and reverify the original webhook after rollout, then prove a real application email callback binds to its actual send attempt.
2. New RedisRateLimitService makes its first EVAL before its lazy connection is ready while offline queue is disabled. Real serving-image proof: first call503, causeStream isn't writeable and enableOfflineQueue options is false; same instance one second later succeeds. Await one shared initial connection before any consume/inspect/consumeOnce/lease admission. Keep offline queue disabled, bounded connection/command timeout, fail-closed credential/cost paths and explicit global-IP local-degradation semantics. Concurrent initial calls must share connection and same budget; unavailable store must still reject. Do not reset or bypass live counters.
3. Main deployment Postmark import writes untrackedbytecode and trips source-cleanliness guard. Use Python-B in both existing wrappers (same executor) to prevent generated cache, preserving all source checks. Retry invocation already proved this guard-preserving correction. Record isolated Docker config invocation used for measured timing; no shared Docker credential changes.

## Execution and proof

- Smallest shared-boundary changes, no dependency/package.json or business-price/policy change.
- Focused positive/negative Postmark HTTP+DB checks with actual module wiring: allthree probes200/no writes; auth and foreign server/stream negatives; real durable callback/dedup/persistence failure unchanged.
- Redis first-use/concurrency/failure test plus actual local Redis cold connection check. Existing lease/global degradation tests pass; no per-caller workaround.
- Wrapper bytecode/import proof and existing deployment security checks required for controller edits.
- API typecheck/contract tests; one scoped PR/CI per branch after local proof. Owner already authorized admin merge after actual CI success. Preserve unrelated working copies and do not dispatch repeated CI for diagnostic iterations.
- Re-read mandatory deployment protocol, fresh main/no active operations, one UAT hotfix with no pending migrations; exact config/readiness/KMS/publicOPEN, then actual webhook/OTP acceptance. Production untouched.
- Billing sales publication/Checkout still needs real authorized UAT Admin plus independent approval; do not invent actors or bypass the existing approval boundary.

## Local evidence

- API build and typecheck PASS; Redis unit8/8; actual isolatedRedis cold concurrency, shared cross-instance budget, inspect, idempotent consumeOnce and lease PASS.
- Fresh isolatedPostgreSQL18.3 all219migrations PASS; real SWC/Nest/PostgreSQL HTTP smoke8groups PASS, including three authenticated synthetic probes/no outbox changes and near-match/auth/body/persistence negatives. Existing Postmark delivery PostgreSQL suite13/13 PASS.
- Kamal28tests (including real wrapper import/no-bytecode proof with inherited suppression removed) and production image security scanner/pin check PASS. No cloud mutations from these fixture checks.
- Initial local HTTP invocation lacked built config workspace dependency; built existing dependency and reran successfully. Initial wrapper fixture wrongly assumed Production default normal; corrected test to its existing hotfix default. These are local harness failures, no CI/deployment retry.

## Delivery and native proof

PR591/develop and PR592/main delivered the exact tested56aba2c6 tree. Full CI35066936157 passed; duplicate35066933135's intermittent Next dev404 is retained, not claimed fixed. Two local exact-source replays passed8groups each. Both merge trees match validated tree; no source/CI retry or skipped test.

Main ee2f5542 deployed as20260916T080218Z-b9eb3d90, signed/OPEN,396.159s. Native Postmark verification200 for Delivery/Bounce/SpamComplaint, zero synthetic business events. Real UI email/message91c088a1 received Gmail SMTP delivery and matching application callback/outbox proof. Actual coldRedis request succeeds and next request remains rate-limited. Real OTP confirmation preserves existing-account opt-in guard. Detailed evidence and remaining native Sandbox/Admin/LINE/marketing boundaries: [release report](../evidence/uat-main-readiness-2026-09-16.md).
