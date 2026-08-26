# Self-service Password Recovery via LINE — Build Plan

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
