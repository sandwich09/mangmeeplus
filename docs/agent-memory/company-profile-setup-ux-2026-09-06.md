# Agent Memory: company-profile setup UX wave (2026-09-06)

Status: in progress on `codex/company-profile-setup-ux` (branched from `origin/develop` 740fa36d). Not merged, no PR, not deployed.

Owner: Owner UAT report 2026-09-06 on a freshly auto-approved LINE-first shop. Spec
`docs/specs/mangmee-line-first-signup-spec-th.md` §15.4 + the new §15.4.1 delta (authoritative).
Prior build and its two review rounds: `docs/agent-memory/line-signup-e-profile.md`.

Scope: the settings page "ข้อมูลร้านและบัญชีของฉัน", the settings hub card, the sidebar
ตั้งค่าบริษัท row, and the three account-email API surfaces that page calls. No schema change, no
migration, no new dependency, no `deploy.sh`/env/flag change.

## Decisions (A–E from the task, restated with what was actually built)

**A. One explicit save for the shop form + VAT.** The VAT `<select>` no longer writes on change.
It is local state (`vatChoice`); "บันทึกข้อมูลร้าน" sends the identity PATCH (when
`buildIdentityPatch` reports a change) and then the VAT PUT (when the choice differs from the
server), in that order, with separate error banners. `load()` seeds the form **once** (a
`seededRef`), so the post-save re-read refreshes `legalIdentityVersion` / `vatRegistration.version`
/ `readiness` without wiping anything the owner is still typing. `shopFormChange()` is a pure
function that answers "identity? vat? neither?" and owns the "ยังไม่มีอะไรเปลี่ยนค่ะ" sentence, so
the guard counts the VAT change too. `UNKNOWN` stays a disabled option.

**B. A verified email is read-only until asked otherwise.** `emailSectionMode(account, editing)` is
a pure function returning `unavailable | edit | pending | verified | none`; the page renders one
block per mode. Verified: the address as text + a `MangmeeBadge tone="lime"` "ยืนยันแล้ว" + a text
button "เปลี่ยนอีเมล" which reveals the input (and "รหัสผ่านปัจจุบัน" when `hasPassword`) and
focuses it; "ยกเลิก" returns. Pending: the sentence naming `pendingEmail` plus "ส่งลิงก์อีกครั้ง"
(`POST …/email/resend`, new client function) and "เปลี่ยนอีเมล". The 409
"already verified for your account" path is now unreachable from the UI.

**C. Email delivery is honest per environment.** `AccountSecurityState.emailDeliveryEnabled` =
`config.emailProvider !== 'disabled'`, computed in `GetAccountSecurityStateUseCase` from an
`@Optional()`-injected `AppConfigService` (the pattern `ConfirmEmailVerificationUseCase` already
uses, so the existing hand-constructed spec fakes keep compiling). `RequestEmailChangeUseCase` and
`ResendEmailVerificationUseCase` refuse with 422 `email_delivery_unavailable` **before** any
`EmailVerificationToken` row is created. The gate is in the use-cases, not the controller, so a
future caller cannot route around it. Web: no send button and a contact note when the flag is
`false`, and `profileChecklist` omits the อีเมลกันหลุด item so the list can finish.
Production keeps `EMAIL_PROVIDER=disabled`; this makes that visible, it does not send mail.

**D. Plain phone copy.** Hint `ใส่เบอร์มือถือ 10 หลัก เช่น 0812345678`, error
`เบอร์มือถือต้องมี 10 หลัก เช่น 0812345678`, exported from `company-profile.logic.ts` as
`PHONE_HINT` / `PHONE_ERROR` so the page and the spec cannot drift. Blank-to-clear survives as a
"ลบเบอร์ออก" text button rendered only when `account.phoneNumber` is set. The public signup form
error and the `invalid_phone_number` API copy were aligned to the same sentence — three different
sentences for one rule is the confusion the Owner reported.

**E. Attention indicator until complete.** `useProfileChecklist(companyId, enabled)` holds the read
(the same two GETs, the same `sessionStorage` answer cache) with a module-level in-flight map so
the sidebar and the hub badge on one page share a single pair of requests. Consumers:
`ProfileCompletenessCard` (unchanged behaviour, still owns the 7-day "ไว้ก่อน" dismissal),
`WorkspaceLayout` (sets `NavItem.attention` on the `settings` module) and `ProfileAttentionBadge`
in the settings hub. Both indicators are gated on `company.legal_identity.manage`, so nobody
without the permission fires a request, and the dismissal deliberately does **not** silence them.

**Simplification taken along the way:** `readChecklistCache` used to answer the sentinel
`'hidden'` for a complete cached list. Every caller already runs `checklistIsComplete`, so the
sentinel was a second way of saying the same thing and it made the hook's return type awkward. It
now answers `ChecklistItem[] | null` and the completeness question is asked once, by the caller.

## Evidence table — real API calls on the local stack

API on 127.0.0.1:3011 (`APP_ENV=local`, dev auth, `WEB_BASE_URL=http://127.0.0.1:3010`), web dev
server on 127.0.0.1:3010, docker postgres 127.0.0.1:15432 `watchdog_bms`, seeded company
`seed-local-company`. Recorded run: see the report; the table below is filled from that run.

| # | method + path | EMAIL_PROVIDER | status | key response / resulting state |
|---|---|---|---|---|
| | (filled in during verification) | | | |

## Open questions / deliberately not done

(filled in at the end)

## Verification

(filled in at the end)

## Next

Push the branch. No PR, no merge, no deploy until the Owner asks.
