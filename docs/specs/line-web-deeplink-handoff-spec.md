# Feature: LINE → Web Deep-Link Session Handoff

> **Billing/LINE correctness delta 2026-09-11:** [owned integration design](mangmee-owned-billing-integration-spec-th.md) and [GW evidence](../research/stripe-line-web-gap-closure-2026-09-11.md) supersede earlier PRO-free promotion/current-company fallback and auto-open handoff descriptions. Current trial is FREE_TRIAL_15; rich-menu promotion keeps paid unavailable. Expired recovery uses /renew with active membership and expiry marker; admin holds stay denied. LIFF waits for a gesture; webhook never silently routes selected expired B into active A. New Stripe billing purpose/Checkout remains unimplemented; no OA deployment in this audit.

> **Billing recovery extension 2026-09-11 — DESIGN ONLY:** [LINE + web billing UI §2.2](mangmee-line-web-billing-ui-spec-th.md) reuse /l/<token>, hash-only/15-minute/single-use และ server-owned target. Billing link ในแชตเป็น generic LIFF entry; mint หลังพิสูจน์คนกด แล้ว consume ใน external browser. 2026-09-28: exchange รับร้าน DISABLED+termDisabledAt แล้ว (`resolveLineHandoffTarget`; target billing/renew ที่ allowlist โดยไม่ยก admin/security hold หรือขยาย business routes); target billing สำหรับผู้มี `company.plan.manage` (ไม่ใช่ OWNER เท่านั้น); `/l/` ตอบ `HEAD` 204 และส่งต่อ client IP; `/l/<token>` บน LINE มี `?openExternalBrowser=1` เสมอ (route อ่าน token จาก path เท่านั้น). Default handoff/start ยังใช้กติกาเดิม. พิสูจน์ตาม [LB02/LB05/LB09–LB11](../plans/mangmee-line-web-billing-ui-plan-th.md); ยัง NOT RUN.

## 1. Status

- Roadmap/checklist item: closes the unimplemented half of `line-ai-channel-auth-spec.md` §5 "Alert to Web Detail" step 4 ("LINE opens web or LIFF-authenticated deep link").
- Owner: thawatchai
- Date: 2026-08-19
- State: DRAFT — awaiting owner decision on §17 Q1/Q2 before build.

## 2. Goal

A LINE message from the assistant or the alert rail links back to a web record. Today those links are
plain URLs: whatever session the opening browser happens to carry decides who reads the page. When that
session belongs to a different account, the user lands on "ไม่สามารถเข้าถึงบริษัทนี้ได้" with no way to
tell why (§3.1 E1–E7). When it belongs to nobody, the user re-types a password on a phone keyboard.

This feature makes the link carry its own proof of identity: a single-use, short-lived handoff token
bound to the exact LINE identity the message was sent to, exchanged at open time for a normal
first-party web session. The link then opens as the person the message was addressed to, on any
browser, regardless of what session was there before.

## 3. Source Docs

- Product/overview: `docs/specs/line-ai-channel-auth-spec.md` (§4 Login and Identity Model, §5 Alert to Web Detail, §7 API and Webhook Behavior, §8 Security, §9 acceptance "LINE alert links back to web detail/action page")
- Related specs: `docs/specs/password-reset-line-flow-spec.md` (session `provider` claim semantics, LINE push rules), `docs/specs/session-logout-security-spec.md`, `docs/specs/auth-authorization-rbac-spec.md`
- Related plans: `docs/plans/auth-httponly-cookie-bff-plan.md`, `docs/plans/web-session-recovery-redirect-loop-fix-plan.md`, `docs/plans/web-access-error-handling-plan.md`
- Task memory: `docs/agent-memory/line-deeplink-company-access-mismatch.md` (the UAT incident that opened this)
- Implementation plan: `docs/plans/line-web-deeplink-handoff-plan.md`

### 3.1 Evidence base

Every claim in this spec traces to one of these. Nothing here is inferred from expectation.

| # | Claim | How it was verified |
| --- | --- | --- |
| E1 | The reported screen is `GET /v1/auth/me` → 403 for the link's company | UAT log group `/ecs/watchdog-bms-uat-api-web`: `{"path":"/v1/auth/me","status":403}` at epoch `1787065210020` = 2026-08-18 22:00:10 ICT, and again at `1787065229424` (the "ลองอีกครั้ง" press) |
| E2 | 178 ms earlier the same browser passed through `/login` | same log group, `{"path":"/v1/auth/me","status":200}` at `1787065209842`. That call carried no company: every company-scoped caller in the web passes `companyId` (`layout.tsx:19` and every `page.tsx`), so the only unscoped caller that can produce it is the `/login` server route (`apps/web/app/login/page.tsx:33`; `dev-login` 404s outside dev). `/login` then resolves a landing from `next`/the home cookie (`resolveLoginLanding`, `session-gate.logic.ts:65`) and redirects into the company layout, whose scoped call is the 403 |
| E3 | The browser that opened the link was signed in as another account | `AuditLog` row `2026-08-18 15:00:09.579` UTC, `action = auth.session.refresh`, `actorUserId = cmsuf0y6c021c2o2z3irtekus` (`bombamse5@gmail.com`) — 440 ms before the 403 |
| E4 | That account has no membership in the link's company | `SELECT` on `CompanyMembership` for `companyId = cmsyp3ex701ip2j5jdjylqzdq` returns exactly two ACTIVE rows: the OWNER `cmsyp3exf…` and `kimtae@gmail.com` (STAFF, ALL_BRANCHES). `bombamse5` is not one of them |
| E5 | The LINE identity that produced the link belongs to the staff user, not to the browser's account | `ExternalIdentity` `Ua7e0c86fd21fd2ad7a9abbde52d7665d` → `kimtae@gmail.com`, `linkedAt 2026-08-18 14:53:23`; `LineCompanyContext` for that LINE id → `cmsyp3ex701ip2j5jdjylqzdq` |
| E6 | Two sessions were live in two independent cookie jars at the same time | `AuthSession`: `cmsysbg1n…` (kimtae, created 14:55:28, ACTIVE, refreshed 14:55:36 per audit) and `cmsx80qbq…` (bombamse5, created 2026-08-17, ACTIVE, refreshed 15:00:09). One cookie jar cannot hold both — the second login would have overwritten the first |
| E7 | This is recurring, not a one-off | All seven `/v1/auth/me` 403s in the retained UAT window (2026-08-16 → 2026-08-19) follow the same shape — a `auth.session.refresh` by an account with no membership in the requested company, ~200–450 ms earlier: 08-17 13:52 (`seed-watchdog-system-admin`), 08-18 15:42 (`cmst7jlvv…`), 08-18 22:00 ×2 (`bombamse5`), 08-19 08:06–08:07 ×3 (`bombamse5`). Three of the four bursts are followed within seconds by a logout and/or a fresh `auth.login.exchange` — the user working around it by hand |
| E8 | The 403 originates in the permission resolver | `apps/api/src/modules/access-control/infrastructure/prisma-permission-resolver.repository.ts:53` `ForbiddenException('No active company membership.')`; mapped by `apps/web/src/common/auth/session-gate.logic.ts:19`; rendered by `apps/web/app/(workspace)/companies/[companyId]/layout.tsx:29` |
| E9 | LINE links are plain URLs with no identity | `apps/api/src/modules/line-ai/domain/logic/line-ai-formatter.logic.ts:50,64`; `process-line-webhook.use-case.ts:304` `absoluteWebLink()`; `line-staff-menu.logic.ts:250` (flex `uri` action); `line-business-card.logic.ts:79,101` |
| E10 | Web login already accepts a destination and sanitises it | `apps/web/proxy.ts:73-78` (cookie-less bounce keeps `pathname+search`), `apps/web/app/login/page.tsx:44`, `resolveLoginLanding` / `sanitizeNextPath` (`session-gate.logic.ts:65`, `middleware.logic.ts:63`) |
| E11 | LINE login to the web does not exist today | `apps/api/src/modules/auth/presentation/auth.controller.ts:282-292` — `POST /v1/auth/line/exchange` throws `ForbiddenException('LINE login is deferred to a future release')` |
| E12 | A single-use LINE token pattern already exists and is battle-tested | `EmployeeLineLinkToken` (`apps/api/prisma/schema.prisma:6022`), `generateLineLinkToken()` = 24 random bytes base64url + sha256 hash (`employee-access.logic.ts:107-118`), 15-minute TTL (`employee-access.logic.ts:7`), atomic claim-before-mutate (`complete-employee-line-link.use-case.ts:63-70`), audit actions `access.employee.line_link.*` (`audit-action.ts:35-38`) |
| E13 | A BFF route can already turn API tokens into a cookie session | `apps/web/app/api/auth/dev-login/route.ts` (exchange → `/auth/me` → `setAuthCookies` → landing), `apps/web/src/common/auth/auth-cookies.server.ts:58-96` |
| E14 | The session `provider` claim decides the temporary-password gate | `issue-token.use-case.ts:47` puts `provider` in both JWTs; `auth.guard.ts:175` skips the `mustChangePassword` block when `provider === 'line'`; the rule is owner-locked in `password-reset-line-flow-spec.md` ("Session provider claim (UC1 scoping)", decision 1, acceptance 3) |
| E15 | Token-in-URL referrer leakage is already mitigated app-wide | `apps/web/next.config.mjs` — `Referrer-Policy: no-referrer` on `/:path*` |
| E16 | UAT resolves the web base URL correctly today | `aws ecs describe-express-gateway-service --service …/watchdog-bms-uat-api-web` → `WEB_BASE_URL = PUBLIC_BASE_URL = https://uat.mangmeeplus.com` |
| E17 | The denial produces no attributable signal | the request log line carries only `method/path/status/durationMs` (sample above), and `AuditLog` has no row for the 15:00:10 denial (queried 2026-08-18 14:50–15:10, 18 rows, none of them a denial) |

## 4. Non-goals

- LINE Login for the web (`/v1/auth/line/exchange` stays deferred — E11). The handoff proves identity from a token the server itself minted for a specific LINE recipient, not from a LINE ID token presented by the browser.
- Customer-facing CRM LINE messages. Those go to CRM customers through each company's own channel (`crm-inbox/infrastructure/line-messaging.adapter.ts`, callers in `deliver-crm-campaign` / `scan-crm-booking-reminders` / `crm-conversation`) and must never carry an ERP handoff token.
- Company switching inside a session. The token opens exactly the company it was minted for.
- Changing what the deep link targets, or which permissions the target page requires.
- Replacing password login. The handoff is an additional entry path, not the primary one.

## 5. User Roles

- Owner: receives assistant answers and alert links for their own companies; multi-company owners keep the company the link was minted for.
- Admin / Manager / Accountant / Finance: same as owner within one company.
- Staff: the primary reporter of this defect — a newly created staff member whose phone still held a previous test account (E3–E6).
- AI assistant user: any linked LINE identity with `line.ai.query`; the assistant's own reply is what carries the link.
- Not a role here: CRM customers (see §4).

## 6. Business Journey

1. Trigger: the assistant answers in LINE, or the alert rail pushes a notification, and the reply includes a web link (E9).
2. System mints a handoff token bound to `{ lineUserId → userId, companyId, target path }` and sends `<web>/l/<token>` instead of the bare path.
3. User taps the link. LINE opens it in a browser — any browser, with any prior session or none.
4. The web exchanges the token server-side, replaces whatever session cookies were present with a session for the bound user, and 303-redirects to the target path.
5. Completion state: the target page renders for the right account. Existing gates still run in order — temporary password, legal acceptance, then the page's own permission check.
6. Exception path: token expired, already used, revoked, or its membership no longer active → the user lands on `/login?next=<target>` with a plain reason, which is exactly today's behaviour for a signed-out visitor (E10). No dead end.

## 7. Business Rules

- A handoff token proves **who the message was sent to**, never what they may do. Every permission, entitlement, branch scope, and ABAC rule is re-resolved at page load exactly as today (`line-ai-channel-auth-spec.md` §8).
- Single use. The first successful exchange burns the token, following `EmployeeLineLinkToken`'s claim-before-mutate order (E12).
- Short-lived. Default TTL 15 minutes, matching `LINE_LINK_TOKEN_TTL_MS` (E12). An expired token is not an error state to recover from — it falls through to normal login.
- Bound to one company and one path. A token minted for company A cannot open company B; the target path is stored server-side, not taken from the URL at exchange time.
- Membership is re-checked at exchange. A user removed from the company between send and tap gets the same refusal as today ("Removing or inactivating a user from a company immediately blocks LINE AI, alerts, deep links…" — `line-ai-channel-auth-spec.md` §4).
- The exchange never widens access: it can only produce a session for the user the token names.
- The previous session in that browser is replaced, not revoked. It may belong to a real second person on a shared device (E6 shows two live jars); revoking it server-side would sign that person out elsewhere.
- Audit both sides: minting (which user, which company, which surface) and exchanging (success, and every refusal reason).

## 8. Boundary and Ownership

- Web owns: the `/l/<token>` entry route, the cookie write (`setAuthCookies`, E13), the redirect, and the "link expired" copy.
- LINE/LIFF owns: nothing new. No LIFF page is added — the token is already server-minted, so `liff.init` is not needed.
- Backend/API owns: minting at send time, the token record, the exchange endpoint, membership re-check, session issuance, audit.
- AI Gateway owns: nothing. It never sees the token; minting happens in ERP Core at the LINE send boundary, after the answer text exists.
- Workers/notifications own: the alert rail asks for a token through the same ERP Core seam before pushing (`dashboard-notifications` `buildLineMessage`, E9/G3).
- Out of boundary: CRM customer channel (§4), company switching, LINE Login.

## 9. Data Model Draft

- Entity: `LineWebHandoffToken`
  - `id` (cuid)
  - `tokenHash` — sha256 hex of a 24-byte base64url secret, unique. The raw token never touches the database, mirroring `EmployeeLineLinkToken` (E12).
  - `userId` — the internal user the LINE message was addressed to.
  - `companyId` — the company context the message was answered in.
  - `lineUserId` — the **chat** the message was sent to, which is a person only in a 1:1 conversation. The webhook sets `chatId = groupId ?? roomId ?? userId` (`line-webhook.controller.ts:75`) and the assistant-reply and ledger-drain seams mint with that same key, so in a group or room this column holds the group/room id and no `ExternalIdentity` will ever carry it as `providerUserId`. The picker and LIFF seams mint with the person's own id. Name kept for the column; read it as "chat key".
  - `targetPath` — server-stored destination, sanitised at mint time with the same rule the web uses (`sanitizeNextPath`, E10). Must start with `/companies/<companyId>/`.
  - `surface` — which sender minted it (`line_ai_reply`, `line_staff_menu`, `notification_push`, …), for audit and for measuring adoption.
  - `status` — `PENDING | USED | REVOKED | EXPIRED`
  - `expiresAt`, `usedAt`, `createdAt`
  - Indexes: `@@unique([tokenHash])`, `@@index([userId, status])`, `@@index([companyId, status])`, `@@index([expiresAt])` for the sweep.
  - Lifecycle: `PENDING` at mint → `USED` on the winning exchange → `EXPIRED` by TTL (lazily, at read time; a sweep may hard-delete rows past TTL + retention) → `REVOKED` when the LINE link it was sent to is severed.
  - **2026-09-06 (Owner decision, "ยกเลิกผูก LINE ไม่ได้เพิกถอน token handoff ที่ค้าง แก้ได้เลย"):** severing a LINE identity revokes every `PENDING` row for that `(lineUserId, userId)` pair, in the same transaction as the sever. Before this, unlinking dropped the identity and the selected-company row but left unspent tokens exchangeable, so a tap within the 15-minute TTL still minted a web session for the account just severed — and a picker-surface token re-created `LineCompanyContext` under a `lineUserId` that may since have been relinked to somebody else. Matching on **both** columns is the point: it cannot resurrect a previous holder's links after a relink, nor reach into the new holder's. Applied by `revokePendingLineHandoffTokens` (`line-handoff.logic.ts`) from all four severing paths — self-serve unlink, admin partner unlink, employee-relink identity sever, and the `link-line-identity` re-point that moves a LINE account to a different user. Each path's existing audit row carries `handoffLinksRevoked: <n>`. `REVOKED` was already in the enum, so no migration; the exchange needed no change — its step-2 `status !== 'PENDING'` check already refuses the row as `token_not_pending`, the same generic 403 a used token gets, and refuses it before the claim, therefore before the session AND before the step-4b `company_picker_open_web` context switch.
  - **2026-09-06 (Owner decision, "ทำ" — defence in depth):** the exchange now re-checks the LINE link itself. At step 3, alongside user/membership/company, it requires an **ACTIVE** `ExternalIdentity` matched on `provider = LINE` + `providerUserId = <token.lineUserId>` + the token's own `userId` — the same keys `resolveLineIdentity` uses, channel-agnostic because the token row carries no channel — and refuses otherwise. **Corrected 2026-09-06 (same day, adversarial review):** that WHERE is right only for a 1:1 chat. Because `lineUserId` is the chat key, a link sent into a group or room carries a group/room id, no identity can hold one as `providerUserId`, and the guard as first written refused **every** assistant deep link sent into a group — fail-closed, so the customer bounced to `/login?line=handoff-expired`. The guard now has two modes, chosen by the id's prefix (`isLineGroupChatKey` in `line-handoff.logic.ts`; LINE encodes the kind in the first character — `U` + 32 hex a user, `C` + 32 hex a group, `R` + 32 hex a room, and anything unrecognised takes the stricter mode): a **1:1** chat key still requires the ACTIVE identity whose `providerUserId` **is** that key and whose `userId` is the token's; a **group/room** key requires only that the token's user still holds an ACTIVE `LINE` identity at all, since a group id names no person. Both are the same single indexed read. This closes the two cases the revoke above cannot: a revoke `UPDATE` that failed, and a LINE account re-pointed at a different user (identity ACTIVE, `userId` no longer the token's). It refuses with the identical 403 body a used or expired token gets — no oracle distinguishes them, and the web route still lands on `/login?line=handoff-expired&next=<target>`; only the audit `reason` differs (`line_identity_severed`). It runs **before** the claim, so a refused link writes nothing: no `USED` flip, no `company_picker_open_web` `LineCompanyContext` upsert, no session. One indexed read (`@@index([userId, provider, status])`) issued inside the step-3 `Promise.all`, so it costs no extra round trip.
  - **2026-09-06 (same decision):** the employee-relink sever (`complete-employee-line-link.use-case.ts` `severOtherLineIdentities`) now runs its `UNLINKED` write, its `LineCompanyContext` delete and its handoff revoke in **one interactive `$transaction` per severed identity** — it opens its own, having no outer transaction to join. Before this the `UNLINKED` write landed first and a failed revoke was unrecoverable: the caller swallows sever failures and the self-heal re-scan filters `status: ACTIVE`, so the half-severed row was already invisible to the retry and its deep links stayed exchangeable for the rest of their TTL. Now the identity stays `ACTIVE` when any of the three fails and the next scan redoes it. The context delete makes all three sever paths leave identical state.
  - Source of truth: ERP Core database. Nothing about the token lives in LINE state.

## 10. Permission and Audit

- Minting requires no user-facing permission — it is a side effect of a message the server already decided to send to that user. It must run **after** the existing per-surface permission checks, never as a way to reach them.
- Exchange is a public endpoint (no session required — that is the point). Its only credential is the token.
- New audit actions, following the `access.employee.line_link.*` naming (E12):
  - `auth.line_handoff.issue` — SUCCESS, `MEDIUM`, metadata `{ surface, companyId, targetPath }` (path is a route, not business data).
  - `auth.line_handoff.exchange` — SUCCESS `MEDIUM` with `{ surface }`; FAILED `MEDIUM` with `{ reason }` where reason ∈ `token_not_found | token_expired | token_not_pending | membership_inactive | company_inactive | user_inactive | line_identity_severed`.
- Security event: reuse `emitSecurityEvent` with a new name `auth.line_handoff.denied` (`apps/api/src/common/logger/security-event.ts:13`) so a CloudWatch metric filter can alarm on a burst of invalid tokens — the same reason `auth.login.denied` exists.
- Never log the raw token, and never put it in audit metadata (`line-ai-channel-auth-spec.md` §8: "Do not store raw LINE access tokens in application logs or audit metadata" — the same rule applies to a token that *is* a credential).

## 11. API Behavior

### `POST /v1/auth/line/handoff/exchange` (Public)

- Permission: none (the token is the credential). Rate limited per IP through the existing auth rate-limit service, the bucket `password/login` already uses.
- Validation: body `{ token: string }`, 24-byte base64url shape; anything else is `token_not_found` (identical response, no enumeration — same rule as `password/reset-request`).
- Server behaviour, in this order (the order is the security property):
  1. Look up by `tokenHash`.
  2. Reject unless `status = PENDING` and `expiresAt > now`.
  3. Re-check the LINE link (ACTIVE `ExternalIdentity` for `(provider LINE, providerUserId = lineUserId, userId)` — 2026-09-06), `User.status = ACTIVE`, `CompanyMembership` ACTIVE for `(userId, companyId)`, `Company.status = ACTIVE`.
  4. Claim atomically: `updateMany({ where: { id, status: 'PENDING' }, data: { status: 'USED', usedAt } })`; `count === 0` → lost the race → refuse. Claim before issuing, exactly as `complete-employee-line-link.use-case.ts:63-70` does.
  5. Issue a session through `IssueTokenUseCase` with the true origin `'line'` (E14, and the rule locked in `password-reset-line-flow-spec.md`).
  6. Audit and return.
- Success response `200 { accessToken, refreshToken, expiresIn, companyId, targetPath, mustChangePassword, legalAcceptanceRequired }` — the same shape the BFF login route already consumes (E13).
- Error cases: `403` with a generic message for every refusal reason (the reason goes to audit, not to the caller). `429` when rate-limited.
- Idempotency/concurrency: the claim in step 4 is the concurrency boundary. Two taps race; one wins; the loser sees the expired-link screen and can still log in normally. A re-tap of an already-used token is **not** treated as success (unlike the employee link QR, where the re-scan is provably idempotent because it only re-asserts an identity link — here a second exchange would mint a second session, which is a new side effect).

### Minting seam (internal, no HTTP surface)

`LineHandoffLinkService.wrap(userId, companyId, lineUserId, surface, path) → absolute URL`. Callers pass a path they have already decided to send; the service mints and returns `<webBaseUrl>/l/<token>`. When `webBaseUrl` is unset, or minting fails, it returns the plain absolute URL it would have produced today — a broken handoff must never cost the user their link.

#### Delta 2026-09-06 — `company_picker_open_web`: the one surface that also switches the LINE chat

Owner request (`line-rich-menu-v2-spec.md` §6.2 delta 2026-09-06): the บริษัทของฉัน picker gets a second
button per bubble that in ONE tap both switches the LINE company context to that company and opens the web
app signed in on it.

- **Why the seam cannot do it.** The send-boundary walk binds ONE recipient `{userId, companyId, lineUserId, surface}`
  to a whole message, and `isSafeHandoffPath(targetPath, companyId)` refuses a path under any other company —
  correctly, because that check is what stops a token for company A being re-pointed at company B. A picker of
  N companies therefore mints N tokens **explicitly**, through `LineHandoffLinkService.linkFor(ctx, targetPath)`,
  which keeps the seam's enabled rule, its degrade-to-plain failure and its never-log-the-token guarantee.
  Only the bubbles on the visible page are minted, plus one for the context card above them (2026-09-06: the
  same button on บริษัทของฉัน itself, so the single-company member who is never sent a picker still has one).
  Tokens are single-use, so a multi-company member's current company is minted twice per view rather than
  sharing one link between the two cards — whichever they tapped second would otherwise be refused.
  `/l/<token>` sits outside `/companies/`, so the seam walks straight past these links and never double-wraps them.
- **Where the switch happens.** LINE sends the server nothing when a `uri` button is tapped, so the LINE half of
  the tap can only run at exchange time. `ExchangeLineHandoffTokenUseCase` upserts `LineCompanyContext` for
  `record.lineUserId` → `record.companyId` **after** the PENDING→USED claim (step 4) and **before** issuing the
  session — after the claim, so an expired, refused, or already-spent link cannot move the chat.
- **Why it is surface-scoped.** The write runs only when `record.surface === LINE_HANDOFF_SURFACE_COMPANY_PICKER_OPEN`
  (`'company_picker_open_web'`, defined once in `auth/domain/logic/line-handoff.logic.ts`). Every other handoff
  link — an assistant reply, an alert — is opened on the customer's own schedule, and silently changing which
  shop their next LINE message is about would be a side effect nobody asked for. Only the button that says
  "เปิดเว็บบริษัทนี้" earns it.
- **State written** is identical to the in-LINE switch (`process-line-webhook.use-case.ts` `handleCompanyCommand`):
  same row key, `aiPausedUntil` KEPT (a support hold means a human has the thread), and the same audit action
  `ai.line.company_context.switch` with `metadataJson { lineUserId: '[REDACTED]', surface }`.
- **Best-effort.** A failed context write logs `line_handoff_company_switch_failed` and the session still issues.
  The token is already spent by then; failing the exchange would cost the customer the page they asked for and
  give them nothing in return.
- **The card outlives its buttons, and that is visible.** A picker carousel stays in the chat log for
  ever, but each `เปิดเว็บบริษัทนี้` link is single-use with the §9 15-minute TTL. A tap on a stale card
  is refused before the claim, so it changes nothing at all: no session, and — the point — **no switch**.
  The web route sends it to `/login?line=handoff-expired&next=/companies/<id>/dashboard`, so signing in
  still finishes the WEB half on the right company while the LINE chat stays where it was. The
  `เลือกบริษัทนี้` button and the `ตอบ N` number beside it never expire, so the two halves of an old card
  behave differently and nothing on screen says so. Accepted for now: บริษัทของฉัน re-sends fresh cards on
  every tap. Revisit if customers report "กดแล้วไลน์ไม่เปลี่ยน" — the fix is a notice on the login bounce,
  not a longer TTL, which would only widen the blast radius of a bearer token sitting in a chat log.
- No schema change: `surface` is the column the row already carries.

## 12. UI Behavior

### Web

- Main screen: none. `/l/<token>` is a route handler, not a page — it exchanges and 303-redirects. No HTML is rendered while the token is in the URL, so the token never reaches a page that could load subresources; `Referrer-Policy: no-referrer` is already global (E15).
- The route must sit outside `/companies/` so the middleware's cookie-less bounce does not intercept it (`isProtectedPagePath`, E10/E14).
- Loading/cover loader scope: none — a redirect, not a render.
- Error state: any refusal redirects to `/login?next=<targetPath>&reason=link_expired`, and the login page shows one line: "ลิงก์นี้หมดอายุหรือถูกใช้ไปแล้ว กรุณาเข้าสู่ระบบเพื่อเปิดรายการนี้". Reusing `/login` rather than a bespoke page keeps the recovery identical to the signed-out path that already works (E10).
- Admin actions: none in this phase.

### LINE/LIFF

- AI question or alert: unchanged text; only the URL in it changes.
- Deep link to web: `<web>/l/<token>` for both plain-text links and flex `uri` buttons (E9). The visible label is unchanged.
- Permission/error state: unchanged — the assistant still refuses before it would send a link the user may not open.
- Mutation boundary: unchanged. The handoff carries identity, never an action.

## 13. Gap and Impact Analysis

Findings from reading the surrounding code and UAT state. Each is either folded into this spec's scope or explicitly parked with its evidence.

| # | Finding | Evidence | Impact | Disposition |
| --- | --- | --- | --- | --- |
| G1 | A deep link opened with another account's session shows "ไม่สามารถเข้าถึงบริษัทนี้ได้" | E1–E8 | 7 occurrences in a 3-day window, 3 accounts, all self-resolved by manual logout/login (E7) | **In scope** — this is the feature |
| G2 | The screen did not say which account was signed in, and its sign-out dropped the destination | `CompanyAccessUnavailable.tsx` before PR #173 | User cannot self-diagnose; after signing out they must find the LINE message again | **Fixed, pending merge** — PR #173 against `develop` (branch `fix/company-access-screen-account-hint`) names the signed-in account and keeps `next=` on sign-out. Handoff removes the need to reach the screen at all |
| G3 | Three different web base-URL resolutions, two with hard-coded fallbacks to a **different environment** | `app-config.service.ts:97` (`WEB_BASE_URL ?? PUBLIC_BASE_URL`, undefined → relative path) vs `line-ai-formatter.logic.ts:11` (fallback `https://mangmeeplus.com` — production) vs `notification.use-cases.ts:725` (fallback `https://app.watchdog.local`) | Masked in UAT today because `WEB_BASE_URL` is set (E16). Any environment that forgets it sends UAT users to production, or to a domain that does not resolve. Minting needs one base URL, so the split has to be resolved anyway | **In scope** — collapse onto `AppConfigService.webBaseUrl` as part of the minting seam; keep an explicit `WATCHDOG_WEB_BASE_URL` override, drop the cross-environment fallbacks |
| G4 | Both post-login gates discard the deep-link destination | `layout.tsx:36-42` — `returnTo` is hard-coded to `/companies/<id>/dashboard`, and both `mustChangePassword` and `legalAcceptanceRequired` redirect with it | A first-time staff member tapping a link lands on the dashboard after accepting terms, not on the record. This is exactly what the reporter's new staff hit: legal acceptance at 2026-08-18 14:55:35 (audit) minutes before the failed link tap | **In scope** — pass the real requested path through both gates; without it the handoff still loses the destination for new users |
| G5 | An access denial produces no attributable signal | E17 — request log has no `userId`/`companyId`; no `AuditLog` row for the denial | Diagnosing G1 required correlating CloudWatch, `AuthSession`, `AuditLog` and `CompanyMembership` by hand. A recurring boundary denial should be visible on its own | **In scope (small)** — audit `access.company.denied` at the resolver's refusal with `{ userId, companyId, reason }` |
| G6 | The temporary-password gate is skipped for `provider = 'line'` sessions | `auth.guard.ts:175`, locked by `password-reset-line-flow-spec.md` decision 1 + acceptance 3 | Today a `'line'` session only ever exists inside LINE/LIFF. A handoff makes it a full web session, so the exemption's blast radius grows. The web layout still redirects to `/change-password` because `/auth/me` reports the credential truthfully (`auth.controller.ts:613-616`), so the **UI** journey stays gated; the **API** exemption widens | **Decision required** — §17 Q1. Recommendation: keep `'line'` (it is the true origin, per the locked rule) and rely on the layout gate, then re-open the exemption in a dedicated pass rather than quietly changing an owner-locked rule here |
| G7 | A one-time token in a chat message can be consumed by something other than the user | Not observed. LINE's link-preview behaviour against our OA has never been measured in this repo | If a preview fetcher follows the URL, the token burns before the tap and every link is dead on arrival — a total failure of the feature | **Must be verified before rollout** — §17 Q2 and Plan Phase 1 gate. Mitigation if it happens: exchange only on `POST` from a tiny interstitial, or require `Sec-Fetch-Mode: navigate` |
| G8 | Deep links are minted for surfaces the recipient may not be able to open | `erp-*-tools.use-case.ts` set `permissionChecked: true` for the **tool result**; the target web route runs its own permission check independently | A user can be handed a link to a page that then refuses them. The handoff makes this *more* visible, because reaching the page no longer fails for the wrong reason first | **Out of scope, recorded** — pre-checking every target route's permission at send time is a separate change; the page's own forbidden state is correct behaviour |
| G9 | CRM customer LINE channels must never receive a handoff token | `crm-inbox/infrastructure/line-messaging.adapter.ts` is used by `deliver-crm-campaign`, `scan-crm-booking-reminders`, `crm-conversation` — all customer recipients | Minting for a customer would create an ERP session for someone who is not an ERP user | **Boundary rule** — §4 and §8; enforced by the seam taking an internal `userId`, which a customer recipient does not have |
| G10 | LINE-only users (no password credential) would have no recovery if a handoff fails | `auth.guard.ts` comment "Null credential (LINE-only users)"; but a UAT query over all 8 ACTIVE LINE identities shows **every one** has a `UserCredential` row and exactly one active membership | No user is stranded today. The fallback to `/login` is therefore a real recovery path, not a dead end — but only while this holds | **Recorded, monitored** — if LINE-only users ever exist, the expired-link fallback needs a second path |
| G11 | Four LINE replies emit a **relative** path, so LINE renders it as plain text and nothing is tappable | `line-substitute-receipt-continuation.use-case.ts:305,328,341,406` push `/companies/…` straight into `replyText`, which `process-line-webhook.use-case.ts:1459` delivers verbatim. Every other surface goes through `absoluteWebLink()` | The substitute-receipt conversation tells the user to open the web and then gives them a string they cannot tap | **In scope, and cheaper than the rest** — these sites need a base URL anyway to be wrapped |
| G12 | Two API-side link builders are dead — but the feature they look like is live, in the AI Gateway | `buildWebLinks()` / `buildSourceLabels()` (`line-ai-formatter.logic.ts`) have zero callers in the API, the gateway, any spec, or this repo's history. The live path is: ERP tools set `webPath` → gateway composes `webLinks` (`response-composer.agent.ts:311-313`) and `sourceLabels` (`orchestrator.agent.ts:265`, `line-ai-turn.use-case.ts:206,252,342`) → API renders them in `formatLineReply` (`process-line-webhook.use-case.ts:332-338`, live from the webhook fallback and the ledger drain) and in the flex card via `safeTenantLink` (`line-business-card.logic.ts:53`) | The 48 `webPath:` builders **do** reach users. They reach them through two renderers, not 48 sites, so the handoff still wraps cheaply — but it must cover `formatLineReply` and the flex card, not just the direct `absoluteWebLink` callers | **Dead pair removed** in the G3/G4/G11 PR. The live renderers are **in scope** for Phase 4 |

### 13.1 Measured impact (2026-08-20)

**How much it costs today.**

| Measure | Production | UAT |
| --- | ---: | ---: |
| `/v1/auth/me` 403 (this defect) | **0** in 14 days (2026-08-06 → 08-20) | 7 in 3 days, 3 accounts |
| LINE webhook events accepted | 72 in 14 days (~5/day); 83 more rejected 401 on signature | the reporter's daily testing |
| Password logins | 47 attempts / 32 successful in 14 days, concentrated 08-15 → 08-18 | — |

Read plainly: production has not hit this once, because production barely uses LINE yet. The cost today
is tester time. It becomes a customer-visible defect at exactly the moment LINE rolls out — which is the
thing currently being tested. This is a *before* the traffic arrives change, not a *because of* it.

**How much it costs to build.** Sizes are measured, not estimated.

- New code mirrors an implementation that already exists and weighs ~350 LOC: `complete-employee-line-link.use-case.ts` (216), `issue-employee-line-link-token.use-case.ts` (65), `dev-login/route.ts` (66) — plus ~237 LOC of spec in `line-linking.spec.ts` as the test comparable.
- Call sites that actually reach a LINE message: **~25 across 5 files** — 12 `absoluteWebLink()` sites in `process-line-webhook.use-case.ts`, 5 `formatRefusal()` callers, 1 flex builder in `line-staff-menu.logic.ts`, 2 in `line-business-card.logic.ts`, 4 relative-path sites in `line-substitute-receipt-continuation.use-case.ts` (G11), 1 in `notification.use-cases.ts` (Phase 5).
- Two more renderers must be wrapped, both fed by the 48 `webPath:` source-ref builders through the AI Gateway (G12): `formatLineReply` (`process-line-webhook.use-case.ts:336`) and the flex answer card (`line-business-card.logic.ts:53`). Wrapping those two covers all 48 builders.
- Call sites that look affected but are not: ~33 of the 38 `webUrl`/`deepLink` builders, which live in `banking`, `reports`, `workflow`, `ai-draft`, `crm-inbox` and answer the **web** API, not LINE.
- `safeTenantLink` (`line-business-card.logic.ts:17-30`) is the strictest existing precedent and the one the handoff should match: it drops the link entirely when no base URL is configured and refuses any path outside `/companies/<companyId>`.

**Blast radius of Q1 (the `provider` decision).** Zero users today: all 8 ACTIVE LINE identities in UAT have
a `UserCredential` with `mustChangePassword = false`. The exemption only bites a user who has a pending
temporary password *and* taps a LINE deep link. Q1 is therefore a policy call about an owner-locked rule,
not a live user-impact call — it can be answered without holding the rest of the work.

## 14. Edge Cases

- Token tapped twice (LINE re-render, double tap): first wins, second sees the expired-link screen with `next` intact.
- Token tapped after the user was removed from the company: refused at step 3, audited `membership_inactive`, falls through to `/login`.
- Token tapped while the same user is already signed in on that browser: exchange still runs; cookies are replaced with an equivalent session. Cheap and idempotent from the user's view.
- Token tapped on a browser signed in as a **different** user: cookies replaced. The other account's server session stays ACTIVE (§7) and its `HOME_PATH_COOKIE` must be overwritten with the new company's landing, or the next visit to `/login` sends the new user to the old user's home (`resolveLoginLanding` reads that cookie — `login/page.tsx:42`).
- Multi-company owner: the token pins the company it was minted for, independent of `LineCompanyContext` changing afterwards.
- Platform access CLOSED: the exchange must fail closed like every other non-public route (`auth.guard.ts` `platformClosed()`), landing on `/maintenance`.
- `webBaseUrl` unset: no token is minted, the plain link ships (§11), and the user gets today's behaviour rather than a broken `/l/undefined`.
- Temporary password pending: layout redirects to `/change-password`; with G4 fixed the deep link survives the round trip.
- Legal acceptance pending: same, through `legalAcceptancePath` (`session-gate.logic.ts:109`), which already preserves a nested `next`.

## 15. Acceptance Criteria

- [ ] A LINE link tapped in a browser signed in as another account opens the target record as the LINE-linked user, without the user signing out by hand.
- [ ] A LINE link tapped in a browser with no session opens the target record without a password prompt.
- [ ] A LINE link tapped twice opens once; the second tap lands on `/login?next=<target>` with the expired-link line, never on a blank error.
- [ ] A LINE link tapped by a user removed from the company does not open the record and is audited with `membership_inactive`.
- [ ] The token never appears in a rendered page, a log line, or audit metadata.
- [ ] Permissions, entitlements, and branch scope on the target page are identical to a normal login — the handoff grants no additional read.
- [ ] `mustChangePassword` and legal acceptance still gate the session, and the deep link survives both (G4).
- [ ] Minting failure degrades to today's plain link, never to a dead URL (G3).
- [ ] A company-access denial is audited with user and company (G5).

## 16. Test Cases

- Unit (API): token generation shape and hashing; `sanitizeNextPath`-equivalent rejection of a `targetPath` outside `/companies/<companyId>/`; TTL boundary at exactly `expiresAt`; each refusal reason maps to the right audit metadata.
- Unit (API): claim race — two concurrent exchanges of one token produce exactly one session (mirror the existing `complete-employee-line-link` race spec).
- Unit (web): `/l/<token>` route sets the cookie set from the API response, redirects 303 to `targetPath`, and rewrites `HOME_PATH_COOKIE`.
- Integration: mint → exchange → `GET /auth/me` with the new session returns the bound `companyId` and the same permission set a password login yields for that user.
- Permission: exchange for a user whose membership was revoked between mint and exchange → 403, no session row created.
- Permission: a token minted for company A cannot open a `/companies/B/…` path even if the URL is edited — the path comes from the record, not the request.
- UI: expired token → `/login?next=…` with the Thai expired-link line; the login form then lands on the original target.
- Edge case: platform access CLOSED during exchange → `/maintenance`.
- Edge case: `WEB_BASE_URL` unset → the reply still contains a usable link (today's behaviour).
- Manual/UAT (G7 gate): send a handoff link to the OA and confirm from `LineWebHandoffToken.usedAt` + audit that nothing consumed it before the human tap.

## 17. Open Questions

- **Q1 (blocking build) — ANSWERED 2026-08-29: `'line'`.** Which `provider` should the handoff session carry? `'line'` is the true origin and matches the owner-locked rule in `password-reset-line-flow-spec.md`, but it extends the `mustChangePassword` API exemption from LINE/LIFF to a full web session (G6). Alternatives: mint `'watchdog'` (contradicts the locked rule), or add a third value and treat it as password-gated (widens the JWT claim union and both verifiers). Owner took this spec's own recommendation: keep `'line'`, rely on the layout gate, re-open the API exemption in a dedicated pass.
- **Q2 (blocking rollout, not build) — STILL OPEN, measured on the next UAT deploy.** Does anything between the LINE OA and the user's tap fetch the URL? Unmeasured (G7). The Phase 1 gate measures it before any user-visible rollout. The build ships behind `LINE_WEB_HANDOFF_ENABLED` (default `false`), so this question gates turning the flag on, not writing the code.
- **Q3 — ANSWERED 2026-08-29: 15 minutes for assistant replies; the alert-rail TTL is decided at Phase 5.** TTL: 15 minutes matches the employee link token, but an alert pushed at night may be tapped in the morning. Longer TTL widens the window a leaked chat log stays useful. Owner decision — 15 min for assistant replies, longer for the alert rail, or one value for both?
- **Q4 — ANSWERED 2026-08-29: assistant surfaces first; the alert rail follows.** Should the alert rail (`dashboard-notifications`) ship in the same phase as the assistant, or follow once the assistant surface has proved the mechanism in UAT?


## 2026-10-01 — transient failure recovery

Owner authorized a focused correction after September 30's Redis-backed rate limiter returned
503 before token exchange. Only the API's contracted 403 refusal (or an invalid local token
shape) enters `handoff-expired`. Network/10-second timeout, 429, other API failures and malformed
success responses return a 503 recovery document with an explicit retry button, leaving cookies
untouched. No automatic exchange retry: a lost response may follow a consumed single-use token.
A subsequent confirmed 403 retains the existing sanitized `next` login path.

This supersedes §11's blanket no-HTML rule only for a static error document: no scripts, external
assets, token interpolation, upstream error details or analytics; CSP blocks external loads,
framing and off-origin forms; `no-referrer`, `no-store` and `noindex` protect the credential URL.
A CSP meta policy also enforces isolation when the web proxy overwrites response headers.
The native GET form retries the current path only on user action. Success still immediately
redirects with the existing HttpOnly cookies. Membership, single-use claims and fail-closed abuse
limits are unchanged.

Login refresh outcomes `unavailable`/`timeout` must retain the existing recovery screen and never
auto-start LINE OAuth. A confirmed `signed_out` may still auto-start; successful recovery still
returns to the destination. The recovery link preserves LINE/return-path parameters and removes only the spent recovery marker.
Existing back-navigation, `auto=0` and closed-platform guards remain.

Acceptance: handoff network/429/5xx/malformed responses yield retry without redirects or cookie
changes; 403 preserves only a safe destination; HEAD never exchanges; success forwards visitor IP
and sets cookies; browser refresh 503 stays recoverable, and retry followed by 401 may start OAuth.


## Amendment 2026-10-28 — free expense drafts

handoff/LIFF/password/login landing ต้อง derive current free eligibility และเปิด source expense path ได้; default เป็น expenses โดยรักษา paid renewal, safe target, legal และ billing recovery รายละเอียดที่มีผลเฉพาะ cohort นี้อยู่ใน [free expense drafts spec](free-expense-drafts-spec-th.md); หลักฐาน local และข้อจำกัด live อยู่ใน [task memory](../agent-memory/free-expense-drafts.md).
