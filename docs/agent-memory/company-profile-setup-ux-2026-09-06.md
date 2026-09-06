# Agent Memory: company-profile setup UX wave (2026-09-06)

Status: implemented and verified on `codex/company-profile-setup-ux` (branched from `origin/develop`
740fa36d). Pushed. Not merged, no PR, not deployed.

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
/ `readiness` without wiping anything the owner is still typing. `buildShopSave()` is a pure
function that answers "identity patch? vat status? neither?" and owns the "ยังไม่มีอะไรเปลี่ยนค่ะ"
sentence, so the guard counts the VAT change too. A client-side validation problem (a half-typed
tax id) stops the whole press rather than quietly saving the other half. `UNKNOWN` stays a disabled option.

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
`PHONE_HINT` / `PHONE_ERROR_MESSAGE` so the page and the spec cannot drift. Blank-to-clear survives as a
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

## Evidence table — real API calls on the local stack (2026-09-06)

API on 127.0.0.1:3011 (`APP_ENV=local`, `AUTH_PROVIDER=dev`, `WEB_BASE_URL=http://127.0.0.1:3010`),
web dev server on 127.0.0.1:3010, docker postgres 127.0.0.1:15432 `watchdog_bms`, company
`seed-local-company`, caller `seed-local-owner` (OWNER, dev bearer). Every row is a real request
against a real database, no mocks. The identity PATCH body was produced by running the shipped
`buildShopSave` against the real `GET identity` response, not hand-written.

| # | method + path | EMAIL_PROVIDER | status | key response / resulting state |
|---|---|---|---|---|
| 1 | GET `/v1/companies/seed-local-company/identity` | local-console | 200 | `legalIdentityVersion 0`, `captureWindowOpen true`, identity all null, VAT `REGISTERED` v3, reasons `tax_id_missing, registered_name_missing, company_address_incomplete, vat_status_unanswered` |
| 2 | GET `/v1/auth/account/security` | local-console | 200 | **`emailDeliveryEnabled: true`**, `emailVerified false`, `hasPassword true`, `username "Owner"` |
| 3 | PATCH `/v1/companies/seed-local-company/identity` | local-console | 200 | `{legalIdentityVersion: 1, revisionId: cmtpoxpk1…}`; body = `buildShopSave().identityPatch` (`INITIAL_CAPTURE`, taxId + registeredName + addressJson, `expectedLegalIdentityVersion 0`) |
| 4 | PUT `/v1/companies/seed-local-company/vat-registration` | local-console | 200 | `{version: 4, resultKind: UPSERT_FACT, replayed: false}` |
| 5 | GET `…/identity` (re-read) | local-console | 200 | both halves persisted: registeredName, taxId `0105561000001`, full address, VAT `NOT_REGISTERED` v4 |
| 6 | POST `/v1/auth/account/email` | local-console | 202 | `{email: owner.recovery@mangmeeplus.test, expiresAt …}`; API console printed a real `verificationUrl` |
| 7 | GET `/v1/auth/account/security` | local-console | 200 | `pendingEmail` set, `pendingEmailExpiresAt` set |
| 8 | POST `/v1/auth/account/email/resend` | local-console | 202 | new expiry, new `verificationUrl`; old token → REVOKED |
| 9 | POST `/v1/auth/account/email/verify` (token from row 8) | local-console | 200 | `{email: owner.recovery@…, verifiedAt: 2026-09-06T10:51:29.833Z}` |
| 10 | GET `/v1/auth/account/security` | local-console | 200 | `emailVerified true`, `pendingEmail null` |
| 11 | POST `/v1/auth/account/email` with the SAME verified address | local-console | 409 | "This email is already verified for your account." — the dead end §15.4.1 B removes from the UI |
| 12 | PATCH `/v1/auth/me/contact` `0812345678` | local-console | 200 | `{phoneNumber: "0812345678"}` |
| 13 | PATCH `/v1/auth/me/contact` `812345678` | local-console | 400 | `{code: invalid_phone_number}` → the Thai copy the form mirrors |
| 14 | PATCH `/v1/auth/me/contact` `""` | local-console | 200 | `{phoneNumber: null}` — blank still clears; the button now says so |
| 15 | POST `/v1/auth/me/password/set` | local-console | 409 | `{code: password_already_set}`. **The happy path could not be exercised**: every ACTIVE member of `seed-local-company` has a `UserCredential` (verified by query — `credentialLess: []`), so the 409 branch is what the seed can prove without inventing a user |
| 16 | GET `/v1/auth/account/security` | **disabled** | 200 | **`emailDeliveryEnabled: false`** |
| 17 | POST `/v1/auth/account/email` | **disabled** | **422** | `{code: email_delivery_unavailable}` |
| 18 | POST `/v1/auth/account/email/resend` | **disabled** | **422** | same code — and there was NO pending token, so the 404 "no pending request" never ran: the gate is genuinely first |
| — | `EmailVerificationToken` count after rows 17–18 | disabled | — | **2 (1 REVOKED, 1 USED) — unchanged.** No token was written for a letter nobody could receive |

## Browser pass (Playwright, chromium, against the same stack)

Four checks, all passing; screenshots under the worktree's `output/company-profile-ux/` (not committed).

1. **Desktop 1440×900, unfinished shop** — the amber dot renders on ตั้งค่าบริษัท with
   `aria-label="ตั้งค่ายังไม่ครบ"`, and the ข้อมูลร้านและบัญชีของฉัน card carries "ยังกรอกไม่ครบ".
   Switching to the finished company in the same session: neither appears.
2. **Mobile 390×844, the Owner's exact sequence** — type ชื่อจดทะเบียน / เลขภาษี / ที่อยู่, then change
   the VAT select: **every typed value is still on screen**. One press of บันทึกข้อมูลร้าน issues
   `PATCH …/identity` 200 **and** `PUT …/vat-registration` 200. After a hard reload both persisted.
3. **Desktop, same company once finished** — dot and badge gone.
4. **Desktop, account section** — a verified address renders as text + "ยืนยันแล้ว" with no input and
   no send button; "เปลี่ยนอีเมล" reveals the box **and focuses it**; "ยกเลิก" returns to read-only.
   The phone hint reads the plain sentence; "ลบเบอร์ออก" appears only once a number is stored, and
   clearing it through that button answers 200.

Local seed data touched by this run: `seed-local-company` legal identity + VAT + owner email/phone,
and `seed-local-company-2` legal identity (reset between browser runs so the indicator could be
proven to APPEAR, not only to disappear). Nothing outside the local docker database.

## Open questions / deliberately not done

- **`password/set` happy path unproven against a live database** — no credential-less ACTIVE member
  exists in the local seed, and inventing one is a data change this task did not call for.
- **`readiness.identity.reasons` still lists `vat_status_unanswered` after this page stores a VAT
  answer** (row 5: VAT is `NOT_REGISTERED` v4 and the reason remains). Traced, not fixed:
  `company-identity.use-case.ts:93` computes `promptResolved = prompt !== null` from a separate VAT
  **prompt** record, and `PUT vat-registration` `UPSERT_FACT` — the only VAT write this page makes,
  and the one §15.4 specifies — never creates one. So the page can never clear that reason, and
  `readiness.identity.complete` stays false for a shop that has answered. It does not affect this
  wave (`profileChecklist` deliberately ignores that reason, per §15.4's four items), but anything
  gating on `readiness.identity.complete` will read a fully-filled shop as incomplete. **Out of
  scope, not fixed — worth a decision from the Owner about whether the fact should resolve the
  prompt.**
- The spec's §15.4 contextual tax-id modal is still not built (unchanged from the previous round).
- No E2E spec was added to `e2e/`; the browser pass was a throwaway file, deleted.

## Artifacts

API — `apps/api/src/modules/auth/application/email-delivery.policy.ts` (new),
`use-cases/get-account-security-state.use-case.ts` (+ spec),
`use-cases/request-email-change.use-case.ts`, `use-cases/resend-email-verification.use-case.ts`,
`use-cases/account-profile.use-case.spec.ts` (the existing home for both email use cases — no new
spec file, so `apps/api/package.json` is untouched).

Web — `features/company-profile/{CompanyProfilePage.tsx, company-profile.logic.ts,
company-profile.api.ts, ProfileCompletenessCard.tsx, use-profile-checklist.ts (new),
ProfileAttentionBadge.tsx (new)}` + `company-profile.logic.spec.ts` and
`CompanyProfilePage.qa.spec.ts`; `common/api/api-error-message.ts`;
`common/components/app-shell/AppSidebar.tsx`;
`features/web-core-workspace/{WorkspaceLayout.tsx, web-core-workspace.model.ts}`;
`app/(workspace)/companies/[companyId]/settings/page.tsx`;
`features/external-signup/signup.logic.ts` (+ spec).

Docs — `docs/specs/mangmee-line-first-signup-spec-th.md` §15.4.1, this file.

No pinned file was touched: `auth.module.ts` and `auth.guard` are unchanged, so no pin re-sync.

## Verification

- Red-then-green per decision, on the specs listed above.
- `apps/web` full suite 1634/1634, `apps/api` full fixed list 6881 tests / 6782 pass / 0 fail /
  99 skipped, `pnpm -r typecheck` clean, `check-di-metadata` clean (870 decorated classes).
- **14 mutations, 14 caught, 0 escaped** — one per decision plus the guards most likely to rot
  (VAT auto-save, the seed-once ref, the VAT half of the change guard, the verified-email mode, both
  API delivery gates, the state flag, the checklist omission, both phone copies, the layout flag,
  the sidebar dot, the hub permission gate, and the hook honouring the card's snooze).

## Next

No PR, no merge, no deploy until the Owner asks. When this does go to UAT, the thing to watch is
that UAT runs `EMAIL_PROVIDER=ses` (sandboxed) while production runs `disabled` — so the page will
look different in the two, on purpose, and that difference is now visible rather than hidden.

## Adversarial review round 2 (2026-09-06) — READY

Reviewed on `review2/company-profile-setup-ux` cut from `origin/codex/company-profile-setup-ux`
4df6dfa7, with `origin/develop` cb7c31ee (#452–#455) merged in. **The merge was clean** — the only
overlapping file was `docs/specs/mangmee-line-first-signup-spec-th.md`, different sections. The
merge commit and one test fix were pushed fast-forward onto the branch.

### Verified, not taken on trust

- **The delivery refusal really is first.** `assertEmailDeliveryEnabled(this.config)` is the opening
  statement of both `RequestEmailChangeUseCase.execute` and `ResendEmailVerificationUseCase.execute`
  — before any Prisma call, before the revoke, before the mailer. Proven live: on
  `EMAIL_PROVIDER=disabled` both routes answered 422 `email_delivery_unavailable` and the
  `EmailVerificationToken` count went **6 → 6**.
- **No hole around the gate.** Those two use-cases are the only writers of `EmailVerificationToken`
  and the only callers of `sendEmailVerification` in the whole API.
- **The `@Optional()` fallback can never fire in production.** `ConfigModule` is `@Global()` and
  `auth.module.ts` already injects `AppConfigService` in two factories, so "absent config ⇒ enabled"
  serves the hand-built specs only.
- **`local-console` cannot report "enabled" off a laptop:** `selectAuthMailer` throws at boot unless
  `APP_ENV=local` (`auth.module.ts:63`).
- **All three indicator call sites gate on `company.legal_identity.manage`** —
  `WorkspaceLayout.tsx`, `settings/page.tsx`, `DashboardPages.tsx:328`. The settings hub page stays
  a server component; the badge is the only client island and renders `null` while unknown.
- **The seed-once ref cannot leak one company's form into another's PATCH:** `CompanySwitcher` uses
  `window.location.assign`, a full page load, so the ref is re-created.
- **The VAT answer cannot be silently dropped:** the whole VAT block is behind
  `{identity?.vatRegistration && …}`, which is present exactly when the reader holds
  `company.vat_registration.read`.

### Browser pass (chromium, local stack, both `EMAIL_PROVIDER` values) — 5/5

Owner's exact mobile sequence (390×844): changing the VAT select fired **zero** requests and left
all seven typed values byte-identical; one press produced exactly `PATCH identity 200` +
`PUT vat-registration 200`; a hard reload showed both halves persisted. Verified email is text +
"ยืนยันแล้ว" with no box and no send button, "เปลี่ยนอีเมล" reveals **and focuses** it, "ยกเลิก"
restores. Pending state after a real 202 shows the pending address with a working resend (202).
Disabled provider hides the send path, shows the note, and drops อีเมลกันหลุด from the checklist.
**"ไว้ก่อน" hid the dashboard card while the sidebar dot and the hub badge both stayed** — the
Owner's "จนกว่าจะตั้งครบ" holds. The collapsed-sidebar dot was confirmed from source rather than
live (`AppSidebar.tsx:388`/`:417` render it outside the `sidebarVisible` guard).

### Two escaping mutations, closed

13 mutations run, 11 caught by the shipped specs, **2 escaped** — both in the partial-failure half
of `saveShop`, which §15.4.1 A pins: gating the VAT PUT on the identity result, and firing
"บันทึกข้อมูลร้านแล้วค่ะ" after a half-failed press. Two assertions added to
`CompanyProfilePage.qa.spec.ts` (red under each mutation, green on HEAD).

### Left open

- **The sidebar dot goes stale-ON in-session.** `useProfileChecklist` re-reads only on
  `[companyId, enabled]` and `invalidateChecklist()` only clears `sessionStorage`, but
  `WorkspaceLayout` is an App-Router client layout that survives client navigation. Finish the
  checklist on the profile page and the card and hub badge clear on their next mount while the dot
  stays until a full page load — the three *can* disagree, transiently, despite the hook's
  docstring. Never wrongly silent, self-heals on reload, so it was left alone. Cheapest fix if the
  Owner asks: a window `CustomEvent` from `invalidateChecklist`, the pattern
  `ACCESS_CONTEXT_STALE_EVENT` already uses.
- **The claim-email path is the remaining live "silent send".**
  `SignupClaimEmailService.sendClaimEmail` stamps `claimEmailLastSentAt` and marks the outbox event
  published even though `DisabledAuthMailerAdapter.sendAccountClaim` returns `null` — on production
  the row records a letter nobody received. `assertEmailDeliveryEnabled` is reusable there, but the
  shape has to differ (a Flow B approval must not 422; it needs an ops alert or another channel).
  Its sibling `RequestPasswordResetUseCase` is **not** a lie today: it is dead code with no route —
  `POST /v1/auth/password/reset-request` goes to `NotifyPasswordResetRequestUseCase`, a LINE push,
  and that is what `/forgot-password` promises ("ส่งรหัสผ่านชั่วคราวไปยัง LINE ที่ผูกไว้").
- **AWS rejected the SES production-access request on 2026-09-06.** `EMAIL_PROVIDER=disabled` is
  therefore the settled production state, not a waiting room, and `deploy.sh` refuses `ses` on
  production regardless. UAT keeps `ses`; the two environments differ on purpose.
- `password/set` happy path still unproven against a live database (unchanged).

### Review verification

`pnpm --filter @watchdog-bms/web exec tsc --noEmit` clean · `pnpm --filter @watchdog-bms/api
typecheck` clean (after `prisma generate`) · `apps/web` full suite **1634/1634** · `apps/api` fixed
list exit 0 · `check-di-metadata` clean (870 decorated classes) · `apps/web` `next build` clean,
every settings route still `ƒ` · no `package.json`, schema, migration, `deploy.sh`, env or flag
change.
