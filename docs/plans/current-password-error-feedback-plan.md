# Current-password error feedback plan

Spec: [current-password-error-feedback-spec](../specs/current-password-error-feedback-spec.md)

- [x] Inspect API, BFF, actual web client, localized feedback and related email reauthentication.
- [x] Return a shared, stable input-error contract only for wrong supplied current passwords.
- [x] Map the contract using existing locale and shared error patterns; leave genuine session recovery unchanged.
- [x] Cover no-mutation and auth/session/password-rule regressions, plus BFF/client integration.
- [x] Run isolated browser checks and API/web typechecks, recording exact evidence.
- [x] Fetch/merge current develop, preserve concurrent date/login-label changes, rerun impacted checks, then normal non-force push.

Implementation scope: two reauthentication use cases, existing error catalogs/page mapping, tests and scoped docs. No general auth rewrite, new dependency, database migration or live mutation.

## Runner integration follow-up

- [x] Move the six password-change error regressions into the already wired `auth-endpoints.spec.ts`; remove the orphan test file without changing package.json or the runtime.
- [x] Verify the official spec-coverage gate, focused auth suites and typechecks.
- [ ] Push the verified test-only follow-up to develop.
