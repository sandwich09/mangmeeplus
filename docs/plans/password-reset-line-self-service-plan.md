# Self-service Password Recovery via LINE — Build Plan

> **Owner decision2026-09-15:** verified-email password recovery through Postmark is approved, including users without LINE. The authoritative new routes, eligibility, fragment proof, current binding, atomic reset/session revocation, no-auto-login and replay contract are in [Postmark spec](../specs/mangmee-transactional-email-provider-spec-th.md#email-recovery-implementation-contract--owner-approval2026-09-15). Existing LINE recovery remains available. Earlier sections saying email routes must stay404/parked or email reset should auto-login are historical and superseded for this feature. Current implementation/evidence status: [task memory](../agent-memory/stripe-postmark-implementation-status-2026-09-13.md); no deployment is authorized.


Spec: `docs/specs/password-reset-line-self-service-spec.md`.
Branch: `codex/line-self-service-recovery` from `origin/develop`.

## Smallest correct change

1. Replace admin-recipient resolution in `NotifyPasswordResetRequestUseCase` with exact-user LINE lookup, create a 30-minute hashed `PasswordResetToken`, and revoke it if detached LINE delivery fails.
2. Extend `PasswordLoginUseCase` so a failed normal-password match may atomically claim a matching recovery token, rotate the credential to TEMPORARY, revoke sessions, and reuse the existing forced-change journey.
3. Update controller summary and forgot-password Thai/English copy. No new route, page, schema, dependency, or package manifest change.
4. Add focused tests for exact-user delivery, no request-time credential mutation, delivery-failure revocation, current-password continuity, one-time recovery claim, expiry, and session revocation.
5. Run focused API tests, focused web tests for affected copy/page behavior when present, then API and web typechecks.

## Verification result (2026-08-26)

- Focused API auth/reset: 39/39 passed.
- Full API suite: passed.
- Focused Web auth: 17/17 passed.
- Full Web suite: 1051/1051 passed.
- API typecheck: passed.
- Web typecheck: passed.
- Diff whitespace check: passed.
- Production maintenance exact-file pins: regenerated with the repository script and `--check` passed (required because password login is a protected source file).

## Scope boundaries

- Admin-driven employee credential regeneration remains unchanged.
- Parked email reset endpoints/use cases remain parked.
- No deploy, migration, or live LINE push is part of this branch.

## Backlog impact review — 2026-08-27

- Integrated current develop including #306 without reverting its scope/UX safeguards; conflict was only the generated maintenance checksum, regenerated through the existing tool.
- Reproduced a real regression: a pending recovery password could overwrite the user's later chosen password (`Missing expected rejection` before the fix).
- Bind the recovery hash to the existing credential hash and recheck the locked credential before claim. This invalidates pending recovery across all existing password writers without changing each module or adding a migration. Serialize repeated requests on the same row.
- Preserve generic response and old-password continuity; show admin/support fallback for missing or unlinked LINE.
- Registered the lifecycle regression and an opt-in real PostgreSQL concurrency suite through the existing auth test entry, without editing package manifests. Dedicated `AUTH_RECOVERY_TEST_DATABASE_URL` must identify a local `_recovery_review_` database.
- Focused auth/reset/SES: 55/55 passed. Real PostgreSQL: one end-to-end lifecycle/concurrency scenario passed with four simultaneous requests, two simultaneous claims, self/admin rotation, stale snapshot, closed access, disabled credential and failed LINE delivery. LINE transport is intercepted; no live push.
- Full API/web, browser and exact-head CI results are recorded in [backlog task memory](../agent-memory/pr-backlog-impact-review-2026-08-27.md).

## Current Messaging binding amendment — 2026-09-14

Resolve only the current Messaging-channel identity and recheck credentials/binding immediately before delivery. Admin QR repair/unlink/sever/reassignment revokes the affected pending recovery tokens atomically with the identity change; preserve generic responses, current-password continuity and the Admin support path. [Focused QR proof](../evidence/billing-integration-2026-09-13/line-admin-qr-repair-result.json) includes actual forgot-password delivery after repair and login rejection of that delivered password after Admin unlink. LINE transport is simulated. Email recovery remains parked pending the owner decision.
