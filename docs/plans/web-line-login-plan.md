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

### Phase 1 — Login Page Entry + Browser LINE Login Flow

- Add "เข้าสู่ระบบด้วย LINE" button to `LoginPage.tsx` beside password login.
- Web flow obtains a LINE ID token in the browser (LIFF or LINE Login OAuth redirect — pick the smallest path consistent with the existing LIFF channel config; record the choice in memory) and calls the existing `/v1/auth/line/exchange`.
- On success: store tokens exactly like password login and route through the same post-login logic (company selection, `mustChangePassword`).
- On link-required: show a clear Thai explanation with the account-link/invite path — never a session.
- Config: reuse existing LIFF/LINE channel env keys; no new secret shapes unless the OAuth-redirect path is chosen (then add redirect URI config with local-tunnel note per LINE AI Channel/Auth Spec §7).

### Phase 2 — Parity, Audit, and Verification

- Audit: LINE web login success/failure events use the same audit actions as password login plus a `method: line` metadata field; failed mapping audited per spec §10 test cases.
- Tests: exchange success (linked+active), refusals (unlinked / disabled user / disabled identity / inactive membership), session parity (revoke-others also kills LINE-initiated sessions), and web login-page state tests.
- Live verification: real LINE Login through tunnel per repo precedent, or recorded owner-accepted external blocker.

## Gate (from checklist item 02C)

A linked user logs in to web via LINE without a password and receives a normal first-party session with identical permission/audit/revocation behavior; an unlinked LINE identity never receives a session or business data.
