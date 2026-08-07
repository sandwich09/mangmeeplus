# Feature: Logout and Session Device Security

## 1. Status

- Roadmap/checklist item: [[plans/master-implementation-checklist|Master Implementation Checklist]] -> 02B. Logout and Session Device Security
- Owner: Codex implementation pass (2026-07-01)
- Date: 2026-07-01

## 2. Source Docs

- Product/overview: [[specs/sme-business-os-overview|SME Business OS Overview]]
- Related specs: [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]], [[specs/forgot-password-reset-spec|Forgot Password and Self-Service Reset Spec]], [[specs/permission-matrix|Permission Matrix]]
- Related plans: [[plans/session-logout-security-plan|Logout and Session Device Security Plan]], [[plans/forgot-password-reset-plan|Forgot Password and Self-Service Reset Plan]]
- Permission matrix: [[specs/permission-matrix|Permission Matrix]]

## 3. Goal

Fix a live bug and close a real self-service gap in session security.

- **Bug fixed 2026-07-01**: the web app's "Sign out" menu item (`AppHeader.tsx`) previously only closed the dropdown. It now calls the BFF logout route (which revokes the session and clears the httpOnly auth cookies), scrubs the legacy stored token keys, and redirects to `/login`.
- **Session model note (2026-07-13)**: sessions live in httpOnly cookies set by the BFF, not in `localStorage`. Cookie presence is never proof of authentication — `GET /v1/auth/me` is the only authentication boundary. See [[plans/web-session-recovery-redirect-loop-fix-plan|Web Session Recovery and Redirect Loop Fix]].
- **UX update 2026-07-04**: the same header profile menu now exposes two authenticated account actions together: `Reset password` and `Sign out`.
- **Gap**: today there is no way for a user to end sessions on *other* devices — for example after leaving a device unattended, losing a phone with a still-valid session, or simply wanting a clean slate — without asking an administrator or waiting for natural token expiry. Add self-service "log out of all other devices."

## 4. Non-goals

- A full session/device list UI ("Chrome on Windows, last active 2h ago", revoke individually). That would require capturing device/IP/user-agent metadata on every `AuthSession`, which does not exist today — out of scope for this pass; a natural fast-follow if the business wants it later.
- Any change to how sessions are issued or how access/refresh tokens are structured — this feature only adds a revoke-many action and fixes the existing revoke-one action's frontend wiring.
- LINE/AI-initiated logout or session revocation — logout stays a web-only, user-initiated action.

## 5. User Roles

- Owner / Admin / Manager / Staff / Accountant or finance: identical self-service behavior — any authenticated user can log out (single session) or revoke all their other sessions. No role distinction; this acts only on the acting user's own sessions.
- AI assistant user: not applicable. LINE/AI must refuse any request to log a user out or revoke sessions on their behalf.

## 6. Business Journey

### 6a. Single-session logout (fix existing)

1. Trigger: user clicks "Sign out" in the web header profile menu.
2. Main user action: confirms the click (no extra dialog needed — this only affects the current device/session).
3. System response: the browser calls the BFF route `POST /api/auth/logout`, which forwards to `POST /v1/auth/logout` (revoking the current session's `AuthSession` row by `tokenId`) and then clears the auth cookies on its own response.
4. Review or approval: none.
5. Completion state: the session cookies (`watchdog_token` and its `watchdog_token.0..N` chunks, `watchdog_refresh`, `watchdog_persist`, `watchdog_csrf`, `watchdog_home`) are cleared by the BFF `Set-Cookie` response — they are httpOnly and browser JavaScript cannot touch them. The client additionally scrubs the legacy pre-cookie `localStorage` keys (`watchdog.accessToken`, `watchdog.refreshToken`, `watchdog.auth.accessToken`), which are dead storage kept only so stale values do not linger, and redirects to `/login`.
6. Exception path: the BFF is reached but the upstream API revoke call fails — the BFF still clears the cookies, so the browser ends up signed out and the server-side row expires at its own TTL. If the browser cannot reach the BFF at all (offline), no `Set-Cookie` is received and the httpOnly cookies therefore remain: the client stays on the current page, re-enables the sign-out action, and tells the user to check connectivity and retry. It must not redirect to `/login` or imply that logout succeeded.

### 6b. Log out of all other devices (new)

1. Trigger: user opens the new Account Security settings page and clicks "Log out of all other devices."
2. Main user action: confirms via a short confirmation dialog (this is a broader action than 6a and deserves one extra click).
3. System response: `POST /v1/auth/sessions/revoke-others` revokes every `ACTIVE` `AuthSession` row for the user except the session making this exact request.
4. Review or approval: none.
5. Completion state: the current device stays logged in; every other device/browser session is immediately invalid on its next request.
6. Exception path: if the user has no other active sessions, the action still succeeds (revokes zero rows) — no error, just nothing to do.

## 7. Business Rules

- Rule: `POST /v1/auth/logout` only ever revokes the session identified by the request's own bearer token — never any other session.
- Rule: `POST /v1/auth/sessions/revoke-others` always excludes the calling request's own session — a user can never accidentally lock themselves out through this action.
- Rule: WatchDog/dev refresh tokens cannot authorize protected requests; only access tokens may be used as request bearer tokens.
- Rule: this feature reuses the [[specs/forgot-password-reset-spec|Forgot Password and Self-Service Reset]] plan's "revoke all active sessions for a user" logic for its own force-logout-on-reset behavior — both features should call one shared session-revocation helper rather than duplicating the query, with reset-password passing "revoke all" and this feature passing "revoke all except current."
- Rule: cookie clearing happens on the BFF logout response even if the upstream API revoke call fails — a reachable BFF must always sign the browser out, never leave it holding a session it believes is dead.
- Rule: auth cookies are httpOnly and can only be cleared by a `Set-Cookie` from the server. Browser JavaScript cannot clear them, so a total browser-to-BFF network failure does not end the session — it ends at its own TTL. Nothing in this feature may weaken the httpOnly model to work around that.
- Audit requirement: `auth.session.revoke_others` is audited (MEDIUM), recording the count of sessions revoked. Single-session logout is audited through `auth.session.logout`.

## 8. Boundary and Ownership

- Web owns: wiring `AppHeader.tsx`'s header profile-menu actions (`Reset password` route + real sign-out flow), and the "log out of all other devices" section of the shared Account Security settings page (the page itself may be created by whichever of this plan or [[plans/forgot-password-reset-plan|Forgot Password and Self-Service Reset Plan]] lands first — see that plan's Phase 4 note).
- Backend/API owns: the existing `POST /auth/logout` route (unchanged) and the new `POST /auth/sessions/revoke-others` route.
- LINE/LIFF owns: nothing in this feature.
- AI Gateway owns: nothing; must refuse any logout/session-revoke request.
- Out of boundary: device/session metadata capture and a full session-list UI (non-goal, see above).

## 9. Data Model Draft

- Entity: `AuthSession` (existing, unchanged) — this feature only queries/updates existing rows (`status`, `revokedAt`) by `userId` and `tokenId`; no schema change required.

## 10. Permission and Audit

- Read permission: n/a.
- Create/update permission: `account.session.read` (existing permission key, already used by `POST /auth/logout` and `GET /auth/me`) is reused for `POST /auth/sessions/revoke-others` — this is a self-service action on the caller's own sessions, not an admin action, so no new permission key is needed.
- Approve/export/admin permission: none.
- ABAC/ownership rules: a user may only revoke their own sessions; there is no "revoke another user's sessions" path in this feature (that would be a distinct admin capability, out of scope here).
- Sensitive actions to audit: `auth.session.revoke_others` (MEDIUM, metadata includes revoked-session count, never token values).

## 11. API Behavior

- Endpoint: `POST /v1/auth/logout` — existing, unchanged. Permission: `account.session.read`. Revokes the current session only.
- Endpoint: `POST /v1/auth/sessions/revoke-others` — new. Permission: `account.session.read`. Validation: none beyond a valid authenticated session. Success response: `{ revokedCount: number }`. Error cases: 401 if unauthenticated (same as any protected route). Idempotency: safe to call repeatedly; a second call simply revokes zero additional rows.

## 12. UI Behavior

### Web

- Main screen: `AppHeader.tsx`'s header profile menu, now containing `Reset password` and a working "Sign out" item; a new "Log out of all other devices" section on the Account Security settings page with a confirmation dialog.
- List/detail/form pattern: no list — this pass does not show individual sessions, only a single revoke-all-others action (see Non-goals).
- Loading/cover loader scope: the revoke-others button shows a scoped loading state and is disabled while the request is in flight.
- Empty/error/forbidden/readonly states: revoking others when there are none to revoke still shows a success confirmation, not an error.
- Admin actions: none — this feature has no admin surface.

### LINE/LIFF

- Not applicable. LINE/AI must refuse any logout or session-revocation request.

## 13. Edge Cases

- Case: user clicks "Sign out" while offline — the page remains in place and shows a retryable failure because the httpOnly cookies survive (no `Set-Cookie` was received) and the server-side session was never revoked. Legacy storage is not scrubbed on this failed attempt, keeping the browser state internally consistent until a connected retry succeeds.
- Case: user clicks "Log out of all other devices" with zero other active sessions — succeeds with `revokedCount: 0`, no error shown.
- Case: a password reset (via [[specs/forgot-password-reset-spec|Forgot Password and Self-Service Reset]]) already force-revoked all other sessions moments before the user separately clicks "log out of all other devices" — safe no-op, same as the zero-other-sessions case above.

## 14. Acceptance Criteria

- [x] Clicking "Sign out" in the web header actually logs the user out: server-side session revoked, auth cookies cleared by the BFF response, redirected to `/login`; if the BFF is unreachable, the user remains on the current page and sees a retryable failure.
- [x] A user can revoke every other active session for their own account in one click, without affecting their current session.
- [x] LINE/AI cannot initiate or perform any logout or session-revocation action.

## 15. Test Cases

- Unit: revoke-others excludes the calling session's own `tokenId`; revoking with zero other sessions succeeds with count 0; audit row written with correct count.
- Integration: after `POST /sessions/revoke-others`, a previously-issued token from another (simulated) session is rejected on its next request; the calling session's own token continues to work.
- UI: clicking "Sign out" results in an actual BFF call, auth cookies cleared by the response, the legacy `localStorage` keys scrubbed, and a redirect — verified live in a browser, not just as a unit test, since the entire point of this feature is fixing a UI wiring bug.
- Permission: unauthenticated requests to `/sessions/revoke-others` are rejected (401), consistent with any other protected route.

## 16. Open Questions

- Account Security settings page was created by this implementation pass at `apps/web/src/features/account-security/AccountSecurityPage.tsx`; [[plans/forgot-password-reset-plan|Forgot Password and Self-Service Reset Plan]] should extend this page rather than creating a second page. As of 2026-07-04, the authenticated entry point is the header profile-menu `Reset password` item.
