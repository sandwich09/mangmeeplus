# Password Reset via LINE — Spec (UC1 forced change + UC2 admin-mediated reset)

Status: APPROVED for build 2026-07-25 (design decisions locked with product owner).
Related: docs/agent-memory/password-reset-line-flow.md (discovery record), docs/plans/password-reset-line-flow-plan.md (build plan).

## Problem

Production has no email delivery (`DisabledAuthMailerAdapter` when `APP_ENV != local`), so the email-based forgot/reset flow silently does nothing while its UI claims a link was sent. Separately, every built-in employee role lacks `account.password.change`, so any employee forced into the change-password screen hits 403 and is locked out of the entire app.

## Product decisions (locked)

1. Temp-password login always forces the change-password screen; once changed, never again. Enforced only for password-login sessions — LINE-login sessions are never blocked by `mustChangePassword`.
2. Forgot-password page = username input only (no LINE ID). Static line shown always: "หากคุณเป็นเจ้าของกิจการ กรุณาติดต่อ support@mangmeeplus.com".
3. Responses are always generic (no account enumeration). Reuse existing password-reset-request rate limits as the cooldown.
4. Reset request notifies company ADMINs via LINE; if requester is an ADMIN → notify OWNER; if no deliverable ADMIN → fall back to OWNER. Owner accounts get no in-company notification (support line covers them).
5. Email flow is closed entirely: endpoints removed from the controller, web pages/BFF route deleted. Backend use cases + `PasswordResetToken` model stay parked for a future revival. No in-app notification fallback for now (skip when nobody has LINE linked).

## Journeys

- **Employee forgot**: `/forgot-password` → submit username → generic success → ADMINs (or OWNER fallback) get LINE push "พนักงาน X ขอรีเซ็ตรหัสผ่าน" → admin opens เมนูพนักงาน → clicks รีเซ็ตรหัสผ่าน on that row → double-confirm popup → temp password shown in handoff modal AND pushed to the employee's linked LINE → employee logs in → forced to `/change-password` → sets own password (now permitted).
- **Admin forgot**: same, but the push goes to OWNER members only.
- **Owner forgot**: submits like everyone (generic reply, no push); static support line directs them to support@mangmeeplus.com. System admin resets via existing partner/onboarding tooling.
- **New employee**: created with DOB-derived password and `mustChangePassword: true` → first password login lands on `/change-password`. Employees who only ever use LINE login are not blocked (decision 1).

## Backend contract

### `POST /v1/auth/password/reset-request` (Public)

Body: `{ username: string }` (trim, lowercase, max 64). Response `200 { message }` — always the same generic message. `429` when rate-limited (reuse `assertPasswordResetRequestAllowed(username, ip)` — the email flow that owned those buckets is closed).

Server behavior (all silent — no behavior difference observable by the caller):
1. Find user by `username` (usernames are stored lowercase). Eligible = user ACTIVE + credential exists and not DISABLED + oldest ACTIVE membership in an ACTIVE company (same selection rule as login).
2. Requester roles on that membership decide targets:
   - contains `OWNER` → no push.
   - contains `ADMIN` → targets = memberships with role `OWNER` in that company.
   - otherwise → targets = memberships with role `ADMIN`; if none deliverable → memberships with role `OWNER`.
3. Deliverable target = ACTIVE membership whose user has an ACTIVE `externalIdentity`. Push via system OA (`config.lineMessagingChannelAccessToken`, same channel the internal notification rail uses). No token configured (local) → skip pushes.
4. Push text (Thai): `🔐 {displayName} ({username}) ขอรีเซ็ตรหัสผ่าน\nไปที่ ตั้งค่า → ภาพรวมสิทธิ์ เลือกพนักงานคนนี้ แล้วกดเมนู "รีเซ็ตรหัสผ่าน"` (points at the live reset location `/settings/access-overview`).
5. Audit `AUTH_PASSWORD_RESET_REQUEST` (existing action): SUCCESS with `{ channel: 'line', recipientCount }` or DENIED `{ reason }` for ineligible/unknown/owner cases. Never log the message body or tokens.

### Regenerate employee credential (existing endpoint, extended)

After the existing transaction commits, if the employee has an ACTIVE `externalIdentity`, push the temp password to their LINE via the same system-OA helper (await with the helper's short timeout; push failure must not fail the request). Response contract `EmployeeCredentialHandoff` gains `lineNotified: boolean`.

Push text: `🔐 รหัสผ่านชั่วคราวของคุณ: {password}\nใช้ได้ถึง {expiry, Thai locale}\nเข้าสู่ระบบแล้วระบบจะให้ตั้งรหัสผ่านใหม่ทันที`. Never write the password to logs/audit metadata.

### Session provider claim (UC1 scoping)

- `IssueTokenUseCase` adds `provider: authProvider` to both access and refresh JWT payloads. Callers must pass the true origin: `exchange-line-token` and `complete-employee-line-link` (and any other LINE-originated issuance) pass `'line'`; password login/reset pass `'watchdog'`.
- `RefreshSessionUseCase` preserves the claim from the verified refresh token (absent → `'watchdog'`).
- `WatchdogJwtVerifierAdapter` surfaces the claim; `AuthGuard` skips the `mustChangePassword` block when `provider === 'line'`. Absent claim (old tokens, dev tokens) keeps today's blocking behavior. No DB migration.

### Permissions (prerequisite fix)

Add `account.password.change` to `ROLE_GRANTS` for: ADMIN, MANAGER, SALES, INVENTORY, FINANCE, ACCOUNTANT, MARKETING, STAFF, AUDITOR_READONLY (matches `pack.core.basics` intent "ทุกคนได้รับอัตโนมัติ"). Existing databases need `prisma/sync-permissions.ts` run (ops step — see plan).

### Employee creation (UC1)

`create-employee.use-case.ts` sets `mustChangePassword: true` on every credential creation/revival path (currently 4 sites set `false`). Credential status/expiry unchanged: ACCEPTED RISK (owner decision 2026-07-25) — the DOB password never expires and stays valid until the first username/password login triggers the forced change; a guessed DOB yields only a module-blocked session until then. Revisit if real LINE login ships.

## Web contract

- `/forgot-password` (repurposed page): username field only, submit → `POST /api/v1/auth/password/reset-request`. Generic submitted state ("แจ้งผู้ดูแลของร้านให้แล้ว หากบัญชีนี้มีสิทธิ์"), 429 cooldown UI kept. Static support line (decision 2) on both form and submitted states. Update `auth.forgot.*` th/en dictionary keys.
- `/login`: add "ลืมรหัสผ่าน?" link to `/forgot-password` (missing today).
- Delete: `app/reset-password/`, `src/features/auth/ResetPasswordPage.tsx`, `app/api/auth/reset-password/route.ts`, `confirmPasswordReset` client fn, `readTokenParam` (verify no other usages; `validatePasswordConfirmation` stays — change-password uses it).
- Employee menu — the LIVE list page `IndividualPermissionsPrototypePage.tsx` at `/settings/access-overview` (build discovery 2026-07-25: `EmployeeAccessWorkspacePage` in `EmployeeAccessPages.tsx` is unrouted dead code and must stay untouched): "รีเซ็ตรหัสผ่าน" action in the selected-employee menu (kebab on the employee header card, next to แก้ไข/ลบ — the page's rows are full-row buttons, so per-row nested buttons are invalid HTML), visible only when `viewerPermissions` contains `access.employee.credential.issue` (owner rows never appear here because owners have no `EmployeeAccessProfile`). Click → double-confirm dialog (shared `Modal`, AccountSecurityPage pattern) → call existing regenerate endpoint → handoff modal (username + temp password + expiry), plus a line driven by `lineNotified`: sent → "ส่งรหัสผ่านชั่วคราวไปที่ LINE ของพนักงานแล้ว", not linked → "พนักงานยังไม่ได้ผูก LINE กรุณาส่งรหัสผ่านให้โดยตรง". The live create journey (`AddEmployeePrototypePage.tsx`) must not claim the first login needs no password change (UC1 forces it).

## Security rules

- No enumeration: identical response body/status for unknown username, ineligible account, owner account, and successful notify.
- Rate limit per username + per IP (existing buckets). Audit every request outcome.
- Temp password travels only to the LINE identity already linked to that exact user account. Never to a LINE ID supplied by input.
- No external calls inside DB transactions. Pushes never fail the parent request.
- Temp password/reset text must never appear in logs, audit metadata, or error messages.

## Acceptance criteria

1. Employee with built-in STAFF role completes the forced password change after a regenerate (no 403), and can change password voluntarily.
2. New employee's first password login redirects to `/change-password`; business modules blocked until changed.
3. Employee with `mustChangePassword: true` using a LINE-login session is NOT blocked.
4. `reset-request`: unknown username → 200 generic + no push; employee → ADMINs pushed; admin requester → OWNER pushed; no deliverable admin → OWNER fallback; owner requester → no push. All audited.
5. Regenerate returns `lineNotified` and pushes to linked LINE only; UI shows the corresponding hint.
6. Email endpoints return 404 (removed); `/reset-password` page gone; login page links to the new forgot page.
7. `pnpm --filter api test` and `pnpm --filter web test` pass; new API specs registered in the hand-maintained test list.
