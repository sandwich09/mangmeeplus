# Current-password error feedback

Status: Approved for implementation by the user's backlog request.

## Outcome and journey

An authenticated user changing their password must be able to correct a wrong current password without being told their session expired or unnecessarily refreshing the session. The same current-password check for changing an email address uses the same error contract.

## Contract and security boundaries

- A present, enabled credential whose current-password verification fails returns HTTP 400 with `code: current_password_incorrect` and `message: Current password is incorrect.`.
- The change-password screen shows exactly **รหัสผ่านปัจจุบันไม่ถูกต้อง** in Thai and **Current password is incorrect.** in English. The shared Thai error catalog also recognizes this code for email reauthentication.
- The BFF preserves the upstream status and code. A 400 is a correctable input error and must not trigger refresh/retry or logout.
- Missing/disabled credentials remain denied with 401. Missing/expired/invalid sessions retain the existing 401 recovery: refresh once and retry once on success, otherwise show session-expiry guidance. Do not reinterpret arbitrary 401s as wrong passwords.
- No credential, session, verification-token, mail or audit mutation occurs on a wrong current password.
- Existing authentication, permission, CSRF and rate-limit boundaries stay in place. Forced first-login change, temporary-password expiry, minimum length, password reuse and successful password/session revocation behavior remain unchanged.
- No schema, dependencies, entitlement, account access or live-environment changes.

## Acceptance and verification

1. Real use cases reject a wrong current password with the stable 400 code before writes; missing/disabled credentials and temporary expiry remain denied.
2. Real BFF and browser API client preserve the code; wrong input causes one request and no refresh. Genuine expired access still recovers; a failed refresh retains session-expiry guidance.
3. Both locale dictionaries render the intended copy; password reuse and minimum length still name their own rules.
4. A local synthetic browser flow exercises the actual change-password page, correction and recovery states where feasible; no real account/session is used.
5. Focused regression suites and API/web typechecks pass. Any unexecuted database/browser checks are explicitly recorded.
