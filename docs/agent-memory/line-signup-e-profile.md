# Agent Memory: Slice L-E — ข้อมูลร้านและบัญชีของฉัน

Status: implemented on `codex/line-signup-e-profile` (branched from `origin/develop` 74ccbb07); not merged, no PR.

Owner: P10-L LINE-first signup. Spec `docs/specs/mangmee-line-first-signup-spec-th.md` §15.4 (authoritative), §3.6, §2.5, §7, §9. Plan `docs/plans/mangmee-line-first-signup-plan-th.md` §0c. Review round 1 finding G-02.

Scope: one settings page + a dashboard checklist card + three account-side API changes. No new tables, no new dependencies, no migration.

## Decisions

1. **No new email endpoints.** `POST /v1/auth/account/email`, `…/email/resend` and `…/email/verify` already existed with a single-use `EmailVerificationToken`. The only thing blocking a LINE-first owner was `RequestEmailChangeUseCase` demanding a current password against a credential that was never issued. Fixed there rather than by adding the `me/email/*` pair the task sketched — one guard instead of two routes.
2. **`company.legal_identity.manage` needed no grant.** `permission-registry.ts:468` gives OWNER `COMPANY_PERMISSION_KEYS` (all of them), and `permission-registry.spec.ts:414-423` asserts no other role holds this key pending QP2. Nothing added to the registry.
3. **Route rule uses `company.setup.read`**, the LOW key every settings-capable member holds. A manager can open the page and read the masked shop block plus their own account section; the shop form un-masks and saves only for `company.legal_identity.manage`, which the API enforces.
4. **Checklist derives from existing reads.** `GET …/identity` already returns `readiness.identity.reasons` (`tax_id_missing` · `tax_id_invalid` · `registered_name_missing` · `company_address_incomplete`) plus the control block, the identity and the VAT view. No `profile-completeness` endpoint was added — the card and the page cannot disagree.
5. **Dashboard card gates on the permission, not the role.** `CompanyDashboardPage` receives `permissions` but not `roles`; `company.legal_identity.manage` is OWNER-only today, so gating on it is both "OWNER only" and "can act on what the card asks for", with no prop threading.
6. **`identityChangeKind` is a deliberate mirror** of the server's `allowedChangeKinds`. The form must know before it submits whether the edit needs a correction reason or a legal date; `company-profile.logic.spec.ts` pins the same table.
7. **Error codes are inline literals, not constants**, because `api-error-coverage.spec.ts` scans the API source for `code: '…'` to prove each has Thai copy.

## Review round 1 (2026-09-05) — 8 findings, all addressed

Independent review of 437cdf41 ran 13 mutations and 3 escaped. Fixes:

- **F1 (HIGH)** a LINE-first owner could store a credential with NO login identifier:
  `PasswordLoginUseCase` looks accounts up by `username OR email`, both null, and a second
  attempt is refused `password_already_set` — unusable and unfixable. `setInitialPassword` now
  refuses with 400 `username_required` when the account has neither a username nor a verified
  email; the form collects ชื่อผู้ใช้ whenever there is no verified email; the route answers the
  STORED (lower-cased) username and the page tells the owner what to type, because the login
  lookup matches the username case-sensitively.
- **F2 (HIGH)** `changedFields()` treated a null `addressJson` as changed, so a fresh shop
  entering only its tax id shipped an all-blank address, took a 422 with no code, and saw
  "โหลดหน้าใหม่" — the tax id never saved. The request body now comes from the pure
  `buildIdentityPatch`, which omits an untouched field and never sends a blank address; the
  422 `details` are translated per field.
- **F3 (MEDIUM)** `setInitialPassword` now revokes other active sessions in the same
  transaction (ChangePassword's rule, `exceptTokenId` = the caller's `sid`), and both it and
  email verification push one LINE notice through the existing `pushSystemLineMessage`. LINE is
  the only out-of-band channel these accounts have.
- **F4 (MEDIUM)** every write control is gated on the key that would refuse the save
  (`company.legal_identity.manage`, `company.vat_registration.manage`) and the masked block is
  actually rendered for a `company.setup.read` holder — `load()` previously copied only unmasked
  values, so a FINANCE member met an editable form full of blanks. The page now takes
  `permissions` from the server component.
- **F5** the username uniqueness read is case-insensitive and covers `email` too. The DB unique
  indexes are plain B-tree (case-SENSITIVE, migrations `20260624000001` / `20260626000000`), so
  this read is the only thing stopping two people holding one login name.
- **F6 (LOW)** both routes spend `assertAccountProfileWriteAllowed` (new per-user bucket,
  `account-profile-write-user`, 10 per 900s, module constants — no config or deploy.sh change).
  `username_taken` made `password/set` an enumeration oracle for any valid session.
- **F7 (LOW)** the checklist card caches per company in `sessionStorage` (10 min) and honours
  "ไว้ก่อน" for 7 days. The email item cannot complete while SES is sandboxed, so without this
  the card fired two GETs on every dashboard mount forever.
- **F8** specs rebuilt: the request body and the form rules are now pure functions with unit
  tests, and `CompanyProfilePage.qa.spec.ts` renders the real component with
  `renderToStaticMarkup`. The `ACTIVE` clause on the phone write and the credential pre-check
  are pinned.

**Deliberate deviation, recorded on request:** spec §15.4 says the page is OWNER. The route rule
uses the LOW `company.setup.read` so a manager can open it and reach their OWN account section
(email, phone, backup password — none of which is company data). Everything company-shaped on
the page is gated on the owner-only keys and enforced again by the API, so the widening grants
read of a masked block and self-service on one's own account, nothing more.

**Contracts (additive, for L-B):** `packages/contracts/src/company-profile.ts` now exports
`COMPANY_PROFILE_SETTINGS_PATH`, `COMPANY_PROFILE_SHOP_HASH`, `COMPANY_PROFILE_ACCOUNT_HASH`,
`companyProfilePath(companyId, hash?)` and **`companyProfileAccountPath(companyId)`** — the last
is what the day-7 กันหลุด nudge should deep-link through the handoff seam. Relative on purpose:
join it to `WEB_BASE_URL` server-side (§15.2 ⑤).

**F9 merge hazard (open):** L-B/L-C touch `auth.controller.ts` + its spec (positional stub
lists), `auth.module.ts`, `audit-action.ts`, `api-error-message.ts`, the `apps/api/package.json`
test list and both pin files. Do NOT rebase until the coordinator says so; on rebase, re-check
the controller spec's constructor stubs BY NAME not position, re-run pin sync, re-run both suites.

## Contract change to note at review

`RequestEmailChangeUseCase` no longer 401s an account with no `UserCredential`. A DISABLED credential still 401s — access taken away is a different fact from access never issued. `forgot-password-reset.use-case.spec.ts` was updated to state the new rule.

## Artifacts

API — `apps/api/src/modules/auth/application/use-cases/account-profile.use-case.ts` (+ spec),
`request-email-change.use-case.ts`, `get-account-security-state.use-case.ts`,
`presentation/auth.controller.ts`, `auth.module.ts`, `audit/domain/models/audit-action.ts`.
Routes added: `PATCH /v1/auth/me/contact`, `POST /v1/auth/me/password/set`.

Web — `apps/web/app/(workspace)/companies/[companyId]/settings/profile/page.tsx`,
`apps/web/src/features/company-profile/*` (page, card, api, logic, spec),
`settings-menu.logic.ts`, `route-permissions.ts`, `DashboardPages.tsx`, `api-error-message.ts`.

`auth.module.ts` is pinned → `node infra/security/sync-production-maintenance-release-pins.mjs`
re-run; outputs (`.github/workflows/deploy-production.yml`,
`infra/security/validate-production-maintenance-release.sh`) committed with it.

## Verification (after review round 1)

- `apps/api` full fixed test list: green, 0 failures. New specs registered in
  `apps/api/package.json` (the only allowed edit there).
- `apps/web` suite: 1426/1426.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm -r typecheck`: clean.
- `apps/web` `next build`: clean; `/companies/[companyId]/settings/profile` listed `ƒ` (dynamic).
- Pin sync: `status=current` (`auth.module.ts` unchanged since the round-1 re-pin).
- **34 mutations, 34 caught, 0 escaped** — one per new guard across both apps, including the
  three the reviewer found escaping. The four that escaped on the first sweep were real test
  gaps and were closed: a case-only username collision needed the stored value to carry the
  uppercase; the address-only PATCH needed its full key set asserted; the shop-form gate needed
  a reader who CAN un-mask but may not write; the dismiss button needed its handler anchored.

## Open questions / not done

- **§15.4 contextual modal at the tax-document issue point: not built.** The accounting-documents issuance path does not evaluate seller tax identity at all in this release — `company_tax_identity_incomplete` is thrown only from `completeCapture` — so a prompt there would fire on a condition nothing computes. The error message now names the new page instead. Revisit when issuance gains the Step 0 gate.
- **Email delivery is unproven end to end.** SES is in sandbox; the no-op mailers only log. The page says so in plain Thai rather than claiming a mail was sent. UAT must confirm a real delivery before this counts as a working recovery path.
- Account merge is a **link only**, per instruction. The `AccountMergeTicket` is minted only by the LINE OAuth `line_linked_elsewhere` path, so the taken-mailbox case sends the user to sign in with the existing account and link LINE there.
- Not exercised against a live database or a browser; no E2E path was added.

## Next

Push, open the PR against `develop` when asked, and put the profile page and the checklist card into the first UAT round alongside the L-B/L-C rehearsals.
