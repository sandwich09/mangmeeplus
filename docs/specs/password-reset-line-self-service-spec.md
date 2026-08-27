# Self-service Password Recovery via LINE — Spec

Status: APPROVED for build 2026-08-26 (product-owner request).
Supersedes: the UC2 admin-mediated reset-request journey in `password-reset-line-flow-spec.md`. Admin-issued employee credentials remain available as a separate support path.

## Product outcome

An OWNER or employee enters their username on `/forgot-password`. If that exact active account has an active linked LINE identity, MangmeePlus sends a short-lived one-time recovery password to that LINE identity.

The current password is not changed and active sessions are not revoked when the request is submitted. On the first successful login with the recovery password, the server atomically:

1. consumes the one-time recovery token;
2. replaces the current credential with that temporary password;
3. sets `mustChangePassword: true` and a short expiry;
4. revokes the user's existing sessions; and
5. creates a new session which redirects to the existing `/change-password` journey.

This prevents a username-only reset request from locking the real user out while still ensuring that the old password stops working once account recovery is actually used.

## Backend contract

### `POST /v1/auth/password/reset-request` (public)

- Input stays `{ username: string }` and keeps the existing username/IP rate limits.
- Response is always `200` with the same generic body for unknown, ineligible, unlinked, delivery-failed, and successful requests. `429` remains the only caller-visible distinction.
- Eligible means: active user, usable credential, active membership in an active company, configured system LINE OA, and an ACTIVE LINE identity linked to that exact user.
- Generate a 12-character/72-bit base64url temporary password with the existing secure-token generator. Store only a domain-separated SHA-256 hash bound to the current credential hash in the existing `PasswordResetToken`; expiry is 30 minutes. Every password change/admin reset therefore invalidates earlier recovery passwords. Serialize repeat requests on the existing credential row, then revoke earlier PENDING tokens for the user.
- Push after the transaction and outside the response timing path. Push only to the linked `providerUserId`; never accept a LINE ID from request input.
- If LINE delivery fails, revoke the newly created token so an undelivered credential cannot remain usable.
- Audit outcome without recording the temporary password, token hash, LINE user ID, or message body.

### `POST /v1/auth/password/login` (existing)

- Always verify the submitted value against the current password hash first.
- If it does not match and has the 12-character recovery-password shape, look for a PENDING, unexpired `PasswordResetToken` whose credential-bound hash matches the submitted value and whose `userId` is the resolved username's user. The parked email-reset flow uses a different token length and hash domain and must not be accepted at login.
- Before consuming it, apply the same user, membership, company, and platform-access checks as ordinary password login.
- Lock/recheck the credential snapshot, then claim token + replace credential + revoke active sessions + write reset-confirm audit in one transaction. A concurrent claim or credential change must fail as invalid credentials without overwriting the winning password.
- Store the submitted recovery password as the temporary credential hash, set `mustChangePassword: true`, and give it 30 minutes from successful recovery login. Do not store an encrypted/revealable copy.
- Issue the normal watchdog session against the updated credential version. Return `passwordChangeRequired: true`; the existing login page sends the user to `/change-password`.
- A valid current password continues to work while a recovery token is pending. It does not consume or activate that token.

## Web copy

- Keep the existing username-only form and submit behavior.
- State that an eligible account receives a temporary password through its linked LINE.
- State that the current password remains valid until the temporary password is used.
- Remove the owner-only support instruction because OWNER follows the same self-service journey.
- Keep the submitted state generic so it cannot confirm account existence or LINE linkage.

## Security rules

- One-time, 30-minute recovery credential; hash-only at rest until it becomes the temporary credential.
- Exact-account LINE binding only; no caller-supplied destination.
- No credential or session mutation at request time.
- Atomic token claim and credential rotation on first recovery login.
- Existing sessions and the old password are revoked only when recovery login succeeds.
- Existing request and login rate limits remain in force.
- No recovery secret in logs, audit metadata, errors, or API responses.
- Unknown and ineligible requests retain the existing minimum response-time envelope.

## Acceptance criteria

1. OWNER and employee with a linked LINE receive a recovery password at their own LINE identity.
2. Submitting a request does not alter `UserCredential` or revoke sessions; the current password still logs in.
3. Recovery password login atomically consumes the token, rotates the credential, revokes old sessions, and returns `passwordChangeRequired: true`.
4. Used, expired, wrong-user, or concurrent token claims are rejected as invalid username/password. After a successful claim, the same value is the short-lived forced-change credential until password change or expiry, so a lost browser response does not strand the user.
5. Successful change-password clears temporary constraints; both the old password and recovery password no longer work.
6. Unknown, unlinked, disabled, inactive-company, and LINE-delivery-failed requests return the same generic response and expose no recovery secret.
7. Focused API and web tests plus API/web typechecks pass.
8. Pending recovery passwords cannot replace a password chosen later by the user or issued later by an administrator. Recovery requests do not disable ordinary login; unavailable LINE has an explicit admin/support fallback in the UI.
