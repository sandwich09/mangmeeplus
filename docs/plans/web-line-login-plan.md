# Web Login via LINE Implementation Plan (Item 02C)

## Status

Ready for implementation handoff. Roadmap placement: item **02C. Web Login via LINE** in [[plans/master-implementation-checklist|Master Implementation Checklist]].

## Linked Specs

- [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]] §21 (owner update 2026-07-06 — requirement source)
- [[specs/line-ai-channel-auth-spec|LINE AI Channel/Auth Spec]] (LINE identity/link rules)
- [[specs/session-logout-security-spec|Logout and Session Device Security Spec]] (session parity)

## Existing Primitives to Reuse (do not rebuild)

- `LineLoginVerifierAdapter` (ID-token verification: issuer/audience/expiry/nonce/signature).
- `POST /v1/auth/line/exchange` + `ExchangeLineTokenUseCase` — already returns first-party tokens for a linked, active `ExternalIdentity`, or a link-required result.
- LIFF pages under `/auth/line/link-page*` for the not-yet-linked flow.
- `AuthSession`/revocation (02B) and `mustChangePassword` handling.

## Phases

### Phase 0 — Existing LINE User Migration Readiness

- Inventory `ExternalIdentity`, `providerChannelId`, user status, active memberships, and `LineCompanyContext` with masked identifiers. Detect duplicate active LINE IDs, conflicts across users, legacy/unknown channel IDs, and stale company context.
- Confirm in LINE Developers Console that the production OA Messaging API, LINE Login, and LIFF channels are under the same LINE Provider. Same-provider channels return the same LINE user ID for the same person; different-provider IDs cannot be safely correlated.
- Same provider + ACTIVE unique mapping: reuse the existing `ExternalIdentity`; do not ask the user to register or link again.
- Same provider + legacy channel/context only: dry-run and idempotently backfill channel/context after membership validation.
- Different provider, conflicting mapping, or recreated LINE account: require password/email-claim-backed secure re-link. Never match by display name, profile image, email, or phone.
- Run shadow resolution before session issuance, then roll out internal → representative existing users → Controlled Beta. Preserve a rollback map and keep existing OA chat available throughout.

Remediation contract:

1. Treat `LINE_MESSAGING_CHANNEL_ID` as the canonical `ExternalIdentity.providerChannelId` for the shared-OA deployment. `LINE_LOGIN_CHANNEL_ID` remains the verifier audience. Production must not create an `unknown` channel identity.
2. Add an idempotent dry-run/backfill command that classifies `AUTO_REUSE`, `BACKFILL`, `CONFLICT`, and `DENY_REVIEW`, masks provider IDs, and emits before/after checksums plus a batch ID.
3. Backfill a unique legacy/unknown row to the canonical channel. When duplicate rows point to the same user, retain one canonical ACTIVE row and mark legacy rows UNLINKED with audit. Different-user conflicts never auto-merge.
4. Make exchange, link/reactivate, request-context resolution, link-token grace, notification/password-reset delivery, and onboarding attach checks use the same canonical resolver. Remove the notification channel-agnostic fallback after the migration gate.
5. Shadow-compare strict and legacy resolution without issuing a session. Every mismatch needs a recorded disposition; eligible strict-match must be 100% and unresolved conflict zero before Beta.
6. Deploy code compatibility first, then dry-run, backfill, shadow, allowlisted session issuance, and finally fallback removal. Rollback starts by closing the web-login feature flag and must leave OA chat/delivery usable.

### Phase 1 — Login Page Entry + Browser LINE Login Flow

- Add "เข้าสู่ระบบด้วย LINE" button to `LoginPage.tsx` beside password login.
- Mobile uses the normal LINE Login v2.1 redirect. Desktop offers `สแกน QR ด้วย LINE`; the QR is a short-lived, single-use, browser-bound login transaction that continues into LINE Login, never the static OA Add Friend QR.
- The QR contains only an opaque public code. Keep the browser completion secret in a same-origin HttpOnly cookie; bind the transaction to `state`, `nonce`, intended action, expiry, and an allowlisted `returnTo`. The mobile callback approves the transaction but never puts the desktop session token in a URL.
- Reuse `LineLoginVerifierAdapter` and the exchange rules in `/v1/auth/line/exchange`; issue a normal first-party session only after verified LINE identity maps to a linked, active user.
- On success: establish the first-party session through the same password-login/BFF mechanism without exposing LINE or session tokens in URLs, then route through the same post-login logic (company selection, `mustChangePassword`).
- On desktop success: the waiting page completes automatically and routes to the allowlisted `returnTo` or company selection without asking for the Mangmee password again.
- Config: reuse existing LIFF/LINE channel env keys; no new secret shapes unless the OAuth-redirect path is chosen (then add redirect URI config with local-tunnel note per LINE AI Channel/Auth Spec §7).

### Phase 2 — Web Login and Auto-register Fallback

- On `LINK_REQUIRED`, switch the same web page to `เข้าสู่ระบบและเชื่อม LINE`; authenticate with the existing Mangmee username/password, then link the verified LINE identity and continue automatically. No business data is returned before linking succeeds.
- If the person has no Mangmee account, `สมัครใช้งาน` enters the official Auto-register + email-claim flow with a signed continuation. After claim/provision, link the pending LINE identity, create the first-party web session, and continue to the intended page.
- On cancel, QR expiry, provider failure, or auto-login failure, automatically show the normal password form and preserve `returnTo`; never prefill or auto-submit a password.
- Disabled/suspended/no-active-membership remains denied. Fallback must not bypass account state or permission checks.
- Keep the three labels distinct in Thai UI: `เพิ่มเพื่อน LINE มั่งมี`, `เชื่อมบัญชี LINE`, and `สแกน QR ด้วย LINE เพื่อเข้าสู่เว็บไซต์`.

### Phase 3 — Parity, Audit, and Verification

- Audit: LINE web login success/failure events use the same audit actions as password login plus a `method: line` metadata field; failed mapping audited per spec §10 test cases.
- Tests: migration dry-run/idempotency/rollback; same-provider existing-user reuse and different-provider re-link; desktop QR and mobile redirect success; linked+active exchange; link-required password/link and Auto-register continuation; cancel/expiry/provider error fallback; browser binding, state/nonce/replay/open redirect/polling rate limit; disabled user/identity/inactive membership refusal; session parity and web login-page state tests.
- Live verification: real LINE Login through tunnel per repo precedent, or recorded owner-accepted external blocker.

## Gate (from checklist item 02C)

An existing same-provider linked user scans the desktop QR or uses mobile LINE Login and reaches the intended web page without registering/re-linking, with a normal first-party session and identical permission/audit/revocation behavior. An unlinked or different-provider user receives no business data and can finish `เข้าสู่ระบบและเชื่อม LINE` or Auto-register; cancel/expiry/error returns to password login without losing the intended destination.
