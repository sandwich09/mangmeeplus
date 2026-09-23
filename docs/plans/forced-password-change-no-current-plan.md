# Forced password change without re-entering the temporary password

## Goal

When a user has just completed a password login with a temporary or first-login credential, the
forced `/change-password` screen asks for a new password and its confirmation only. A voluntary
password change still requires the current password.

## Security boundary

- `AuthSession.passwordCredentialVersion` is written only when `PasswordLoginUseCase` has verified
  the credential.
- The API accepts an omitted `currentPassword` only when the session snapshot exactly matches the
  current credential and `mustChangePassword` remains true.
- LINE sessions, stale sessions, sessions created before an admin reset, and ordinary changes do
  not meet that condition and must supply the current password.
- Partner-member password resets revoke every active session in the same transaction.

## Acceptance

- Forced first-login and LINE recovery forms render `รหัสผ่านใหม่` and `ยืนยันรหัสผ่านใหม่`, not
  `รหัสผ่านปัจจุบัน`.
- Ordinary `/change-password` keeps current-password reauthentication and adds confirmation.
- A matching forced password session can save without `currentPassword`; a stale proof receives no
  such form and the API rejects an omitted value without mutating the credential.
- Password reuse, minimum length, expiry, session revocation, and post-change sign-out remain in
  force.

## Verification

- Focused API and web regression suites cover the proof, stale-session rejection, forwarding, and
  rendered fields.
- API and web typechecks pass.
