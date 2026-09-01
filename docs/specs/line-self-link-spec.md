# Self-Service LINE Account Link Spec

Status: **Approved for implementation** (Owner mockup approval 2026-09-01)
Owner decision trail: production incident 2026-09-01 — customer (companyId `cmtcn30q90ywx305mio9etpbi`) could not
link LINE because the owner QR expired and the onboarding run id needed to reissue it is recoverable only from the
production database. Owner approved the sidebar-user-menu placement mockup and ordered implementation.

## Linked material

- [[specs/line-ai-channel-auth-spec]] — LINE identity/link rules (token hashing, single-use, sever-on-relink)
- [[plans/web-line-login-plan]] — item 02C prior art; LINE *login* stays deferred, this spec is *linking* only
- `docs/agent-memory/owner-line-qr-expired-workaround.md` — incident state and slice A (admin console QR button)

## 1. Problem

Every LINE-link QR is minted by an admin and handed over out-of-band. When it expires before use:

- **Owner QR (72h):** reissue requires the onboarding run id — shown once at company creation, no list
  endpoint, no UI lookup. Recovery = read-only psql on the production bastion. (Fixed for support staff by
  slice A, but the customer still waits on us.)
- **Employee QR (15m):** reissue requires an admin with `employee.manage` opening the employee console.

The user who is already logged in to the web app cannot link their own LINE account at all: the web app calls
no `/auth/line/*` endpoint anywhere, and the parked account-security page's LIFF `link` mode depends on a
`localStorage` token the httpOnly-cookie BFF never writes.

## 2. Goal

A logged-in member links (or re-links, or unlinks) their own LINE account from the sidebar user menu, on any
feature package, with zero admin involvement. QR expiry becomes a non-event: the user mints a fresh link
themselves.

Non-goals: LINE *login* (`/auth/line/exchange` stays fail-closed per 02C deferral); customer (CRM contact)
linking; any change to the admin-issued QR flows.

## 3. User journey

Entry point: sidebar footer → user menu popup (`AppSidebar.tsx`), new item between **Reset password** and
**ออกจากระบบ**. No new page, no new route, no entitlement gate — the user menu exists in every package
(owner correction 2026-09-01: the account-security settings page is NOT in the starter package; do not use it).

| State | Menu item | On click |
| --- | --- | --- |
| No ACTIVE LINE identity | `เชื่อมบัญชี LINE` + badge `ยังไม่ได้เชื่อม` (amber) | Mobile: mint token → navigate to LIFF link URL (LINE opens). Desktop: mint token → modal with QR to scan. |
| ACTIVE LINE identity | `บัญชี LINE` + badge `เชื่อมแล้ว` (green) | Modal (both form factors): linked-at date, **เปลี่ยนบัญชี LINE** (mint token → same mobile/desktop split; completing the link severs the old identity), **ยกเลิกการเชื่อม** (confirm → `POST /v1/auth/line/unlink`). |

Mobile vs desktop uses the same breakpoint mechanism the sidebar already uses for its drawer/desktop split.

Desktop modal requirements: QR image, "สร้าง QR ใหม่" button (mint again; server revokes the prior PENDING
token), expiry note ("ใช้ได้ครั้งเดียว หมดอายุใน 15 นาที"), close button. SHOULD poll link status every ~5s
while open and swap to a success state when the identity appears, so the user gets confirmation without
reopening the menu.

## 4. Contracts

### 4.1 `POST /v1/auth/line/self-link-token` (new)

- Auth: standard session; `@RequirePermissions('account.identity.link')`. No request body.
- Scope: mints an `EmployeeLineLinkToken` for the **caller's own** ACTIVE membership in the request-context
  company. 404 if no ACTIVE membership in an ACTIVE company (mirrors redemption checks — never mint an
  unclaimable token).
- TTL: **15 minutes** (`generateLineLinkToken()` default). The requester is present and can re-mint freely;
  the 72h TTL exists only for admin→customer chat handoff and MUST NOT be used here.
- Behavior: transactionally revoke prior PENDING tokens for the membership, create the new token
  (`issuedByUserId = userId` — self-issued), audit, return `EmployeeLineLinkPackage`
  (`linkUrl`, `qrImageUrl`, `expiresAt`) via `buildLineLinkPackage` + `trustedPublicApiBase` (H-09: never
  derive the QR base from client-suppliable headers).
- Audit: new `AuditAction` for self-issue, risk MEDIUM, target = membership, metadata `{ companyId }`.
  (Self-scoped consent; CRITICAL is reserved for admin-issued credentials for someone else.)

### 4.2 Redemption — unchanged

The minted token rides the existing public LIFF page (`GET /auth/line/link-page/employee`) and
`POST /v1/auth/line/employee-link` (`CompleteEmployeeLineLinkUseCase`): single-use atomic claim,
membership/company re-check, `allowReassign` sever of other LINE identities, used-token re-scan grace.
No changes to any of it — self-issued tokens are indistinguishable from admin-issued ones by design.

### 4.3 Link status — extend `GET /v1/auth/account/security`

Add to `AccountSecurityState` (API use case + web type, additive):

```ts
lineLinked: boolean;        // ACTIVE LINE identity exists for the user
lineLinkedAt: string | null; // linkedAt of that identity
```

The sidebar fetches this lazily when the user menu opens (not on shell mount) and the desktop modal polls it.
The user-menu item itself renders from `session.permissions` alone, so the menu never blocks on this call —
badge appears when the fetch lands.

### 4.4 `POST /v1/auth/line/unlink` — existing, reused as-is (`account.identity.unlink`).

## 5. Permissions

Rule: **every role that can change its own password can link/unlink its own LINE account.** Grant
`account.identity.link` + `account.identity.unlink` to each role block in `permission-registry.ts` that
carries `account.password.change` and lacks them today (MANAGER, FINANCE, ACCOUNTANT, STAFF at minimum;
apply the same rule to any other block found). OWNER (full set) and ADMIN (already granted) are unchanged.

Employees are the point: they hit the 15-minute QR expiry most often. Both actions are strictly self-scoped
(`ctx.userId` only), so the widened grant exposes no one else's data. `showAccountSecurity` in
`WorkspaceLayout.tsx` already keys on these permissions, so the menu section lights up for the new roles
automatically — this also means employees gain the Reset password item, which is correct (it links to
`/change-password`, self-scoped as well).

Role-template parity/read-coverage specs must be updated in the same change if they pin these grants.

## 6. Security invariants (unchanged from H-09 / channel-auth spec, restated as acceptance)

1. Raw token appears only in the returned package; storage holds the SHA-256 hash.
2. QR renders locally (data URI) — the link URL never leaves as a query param to a third-party image host.
3. Single-use, atomic claim; minting revokes the prior PENDING token for the membership.
4. Linking severs all other ACTIVE LINE identities of the user (old phone cannot keep logging in).
5. Self-link mints only for `ctx.userId` — there is no parameter to mint for anyone else.
6. Endpoint is authenticated + permission-checked; per-user rate limiting SHOULD follow the existing
   `AuthRateLimitService` pattern if a one-line fit exists (low abuse value: auth required, mint revokes prior).

## 7. Acceptance criteria

1. STAFF-role user on a starter-package company links LINE from the sidebar menu on a phone without any admin
   action; badge flips to เชื่อมแล้ว.
2. Desktop: same user sees a QR modal, scans with the LINE app, link completes; "สร้าง QR ใหม่" works after
   letting one expire.
3. เปลี่ยนบัญชี: linking a second LINE account severs the first (old account gets no session via LINE AI).
4. ยกเลิกการเชื่อม unlinks and the badge returns to ยังไม่ได้เชื่อม.
5. A user with no ACTIVE membership in the current company gets 404 from mint, and no token row is created.
6. Focused specs cover: mint use case (self-scope, TTL, revoke-prior, no credential touch), controller
   permission metadata, permission-registry grants, extended account-security state.
7. LINE login remains fail-closed (`line/exchange` untouched).
