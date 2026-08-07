# Web Session Recovery and Redirect Loop Fix

Status: Deployed and production-smoked 2026-07-13; local browser E2E re-run pending local API stability
Owner: Codex harness; Claude Opus 4.8 implementation and review
Related: [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]], [[specs/session-logout-security-spec|Session Logout and Device Security Spec]]

## Defect and outcome

Production enters `ERR_TOO_MANY_REDIRECTS` when `watchdog_token` exists but is expired,
revoked, malformed, or incomplete. The route proxy treats cookie presence as authentication,
while protected server layouts validate `/auth/me` and redirect rejected sessions back to
`/login`. Users must always reach either a valid authorized destination, a recoverable login
screen, or an honest unavailable/error state; cookie deletion must never be required.

## Confirmed boundaries and gaps

- `/login` must not redirect solely because an access-cookie name exists.
- Cookie-less protected routes may still use the proxy fast redirect to `/login?next=...`.
- `/companies/*` and `/system/*` must validate the real session server-side before rendering
  protected shells. `/system/*` additionally requires the `SYSTEM_ADMIN` role.
- `GET /auth/me` outcomes must remain distinct: `401` is signed out, `403` is forbidden, and
  network/5xx failures are unavailable. Unavailable must not become login loops or 404s.
- Login must attempt the existing refresh-cookie recovery before showing the form when the
  access session is rejected. A failed refresh clears every normal/chunked auth cookie through
  the existing BFF response.
- Page middleware cannot observe `watchdog_refresh` because its path is `/api/auth`; it must not
  infer refresh absence from that cookie on page requests or use `watchdog_home` as proof.
- `next` targets must use the existing `sanitizeNextPath()` everywhere, including forced
  password change. Protocol-relative targets such as `//example.com` are rejected.
- A missing/mismatched CSRF cookie must remain fail-closed. If self-recovery is added, retry only
  the stable middleware CSRF failure (not arbitrary permission 403s), refresh at most once, then
  retry the original mutation once.
- Offline browser JavaScript cannot clear httpOnly cookies. Keep the BFF rule that cookie clearing
  succeeds even if upstream API revocation fails; do not claim that a total browser-to-BFF network
  failure cleared httpOnly cookies. Correct stale docs rather than weakening cookie security.

## Smallest correct implementation

1. Move the authenticated `/login` decision to a server-authenticated boundary using the existing
   `fetchServerSessionResult`, cookie helpers, and sanitized `next`/home fallback. Never validate a
   session by decoding or trusting JWT claims in middleware.
2. Keep middleware as a cheap presence gate for protected routes and CSRF, but remove the
   cookie-presence redirect away from `/login` and the impossible page-level refresh-cookie check.
3. Extend the shared server-session result with an unavailable/error state. Company and system
   layouts render/throw an honest server error for unavailable; only 401 enters recovery.
4. Add the same real-session guard to the system layout and fail closed for non-system admins.
5. Reuse `sanitizeNextPath` in the change-password success redirect.
6. Add only the minimum CSRF recovery signal/retry needed to distinguish CSRF failure from business
   permission 403. Do not add dependencies or a new session framework.
7. Align session/logout docs with the httpOnly-cookie model and record final evidence in task memory.

## Acceptance and regression matrix

- No cookie: `/login` renders; protected company/system routes redirect once to login.
- Valid access: `/login?next=<safe>` redirects to the safe target; default landing is system
  partners for `SYSTEM_ADMIN`, otherwise the session company dashboard.
- Expired/revoked/malformed access plus valid refresh: login recovery rotates cookies once and
  reaches the original safe target.
- Expired/revoked/malformed access plus missing/invalid refresh: cookies clear and login renders;
  no redirect loop.
- Normal and malformed chunked access cookies follow the same behavior.
- Auth API 403 stays forbidden; 5xx/network error is unavailable and never redirects to login/404.
- A non-system-admin cannot render the `/system/*` shell.
- `next=//example.com` on login/change-password never navigates off-origin.
- Missing CSRF cannot mutate; recovery, if performed, is one refresh + one retry and never retries
  an unrelated 403.
- Existing login, refresh, logout, password-change, cookie chunking, CSRF, company workspace, and
  system-admin flows remain green.

## Verification

- Focused unit/integration tests for middleware decisions, login landing/session result mapping,
  company/system layout policy where practical, redirect sanitization, CSRF retry, and cookie chunks.
- `pnpm --filter @watchdog-bms/web test`
- `pnpm --filter @watchdog-bms/web typecheck`
- `pnpm --filter @watchdog-bms/web build` when the environment permits.
- `git diff --check`
- After deployment only: production header/browser matrix using invalid test cookies, then a real
  login/logout smoke. Deployment is outside this implementation handoff until the owner requests it.

## Harness rules

- Claude may edit implementation/tests/docs and run checks; it must not stage, commit, push, deploy,
  or modify the existing user-owned `.env.example` change.
- Codex owns acceptance, reviews every diff, reruns evidence, and closes remaining gaps.
- Any disagreement that changes product policy, security posture, or user journey stops for owner
  decision; implementation preferences that preserve this contract are resolved by the harness.
