# Agent Memory: password-reset-line-flow

Status: COMMITTED a9333b71 on `feat/password-reset-line-flow` (2026-07-25). NOT pushed, NOT deployed; live UAT pending (local DB was down). Review round closed: 2 P1s fixed (timing-leak detach, custom-role backfill), 3 P2s fixed, rest deferred with rationale in the plan doc. Final: api typecheck clean, web typecheck clean (needed contracts dist rebuild + stale .next/types stubs removed), api suite 2180/2180, web suite 297/297. Admin push text repointed to ตั้งค่า → ภาพรวมสิทธิ์ (live reset UI is IndividualPermissionsPrototypePage at /settings/access-overview; EmployeeAccessPages.tsx is unrouted dead code, zero diff). Concurrent codex/m-01 session cleaned its own files out of the shared tree mid-build (reflog: branch hop + reset) — verified our change set intact incl. both new spec registrations in apps/api/package.json. NOT committed yet.
Owner: thawatchai
Scope: Reset-password journeys for owner + employee. Replace dead email-based self-service with LINE/admin-mediated flow.
Docs: docs/specs/password-reset-line-flow-spec.md + docs/plans/password-reset-line-flow-plan.md (lane ownership, ops notes).

Locked answers to the open questions (2026-07-25):
1. mustChangePassword block scoped by JWT `provider` claim — `'line'` sessions exempt (no DB migration; refresh preserves claim; absent claim = block as today).
2. Username-only input. 3. Generic responses + reuse existing reset-request rate buckets; static line "หากคุณเป็นเจ้าของกิจการ กรุณาติดต่อ contact@mangmeeplus.com" always shown.
4. No deliverable ADMIN → notify OWNER; admin requester → OWNER; owner requester → no push. TTL stays 72h.
5. Email flow closed (controller endpoints removed, web pages/BFF deleted); use cases + PasswordResetToken parked for future. No in-app noti fallback yet.
Build facts: internal LINE rail uses system OA token (config.lineMessagingChannelAccessToken); api test list is hand-maintained in apps/api/package.json; LoginPage lacked a forgot link (Lane C adds); worktree shared with another active session — baseline of pre-existing dirty files saved at scratchpad git-baseline-before-lanes.txt; commit must stage surgically.

Decisions:
- Direction agreed in discovery: UC1 = temp-password login always forces /change-password (owner already works; employee create must flip `mustChangePassword` to true). UC2 = public "request reset" page (username input) -> LINE noti to company admins -> admin/owner presses Reset button in employee menu (double-confirm) -> show temp password + LINE-push it to the employee's linked LINE. Admin forgot -> owner resets. Owner forgot -> contact Mangmee support (system admin regenerates via partner/onboarding pages, already exists).
- Button visibility: OWNER sees reset for everyone; ADMIN sees all except owner. Owner has no EmployeeAccessProfile row so is absent from employee menu -> admin-cannot-reset-owner is structural (verify at spec time).

Findings (verified in code):
- P0 prerequisite: all built-in employee roles (ADMIN/MANAGER/SALES/INVENTORY/FINANCE/ACCOUNTANT/MARKETING/STAFF/AUDITOR_READONLY) lack `account.password.change` in ROLE_GRANTS (permission-registry.ts). Forced change + voluntary change + set-email all 403. Only OWNER/SYSTEM_ADMIN/COMPANY_VIEW have it. pack.core.basics says it should be universal. Fix registry + run prisma/sync-permissions.ts before UC1/UC2.
- Prod mailer is DisabledAuthMailerAdapter (auth.module.ts factory, APP_ENV=production); EMAIL_PROVIDER=ses throws at boot. Email forgot/reset + email verification are silent no-ops in prod.
- Employee create: DOB password DDMMYYYY, credential ACTIVE, mustChangePassword=false, no expiry (create-employee.use-case.ts:110,127-133). Regenerate: TEMPORARY, mustChangePassword=true, 72h TTL, tempPasswordEncrypted revealable (regenerate-employee-credential.use-case.ts).
- Guard blocks ALL non-/v1/auth/* routes while mustChangePassword=true regardless of auth provider (auth.guard.ts:96-107). LINE-exchange sessions are issued with provider 'line' (exchange-line-token.use-case.ts:74) so scoping the block to password sessions is feasible — must decide in spec or LINE-first employees get bricked by UC1.
- Existing rails to reuse: regenerate endpoint + handoff modal in EmployeeAccessPages.tsx (:676 button, no double-confirm yet, lives in detail panel); LINE push pipeline with delivery-claim in dashboard-notifications/notification.use-cases.ts (pushLineMessage :708, resolves externalIdentity.providerUserId); AuthRateLimitService patterns for identifier+IP limits.

Product decision CLOSED (owner call, 2026-07-25): DOB-derived initial password (DDMMYYYY) stays NON-EXPIRING and remains valid until the employee's first username/password login, which forces the change. Matches the shipped implementation exactly — no code change was needed. Accepted residuals, deliberately: a DOB guesser gets a watchdog session blocked from all modules except /v1/auth/* (they could complete the password change themselves — still strictly better than the pre-fix full access), and if LINE login ever ships, LINE-first employees keep the DOB password until their first password login. Revisit ONLY if real LINE login gets built.

Resolved historical questions (kept for context):
1. UC1 x LINE-first employees: enforce mustChangePassword block only for password-login sessions?
2. Confirm input = username only (drop "LINE ID" — system stores internal U… id, not typable vanity id).
3. Anti-enumeration: submitted screen always generic + static "owner? contact support" line (role-specific message leaks account existence). Cooldown: 1 pending request per user per window.
4. Temp-password TTL for reset-by-request path: keep 72h or shorten (e.g. 24h)?
5. Fate of email reset stack (PasswordResetToken, forgot/reset pages, 2 use cases, BFF route): replace /forgot-password UI with new request page; park vs delete backend.
6. Fallback when no admin has LINE linked: in-app dashboard notification at minimum.

Artifacts:
- Discovery conversation 2026-07-25 (this file is the record).

Verification:
- ROLE_GRANTS check run via tsx eval against apps/api registry: OWNER/SYSTEM_ADMIN/COMPANY_VIEW HAS account.password.change, all 9 employee roles MISSING.
- Local DB not checked (docker :15432 down at the time); static seed path (seed.ts/sync-permissions.ts write exactly ROLE_GRANTS) is conclusive.

Next:
- Write spec docs/specs/ for the two use cases incl. permission-fix prerequisite, then plan, then implement. Do not start without user go-ahead.
