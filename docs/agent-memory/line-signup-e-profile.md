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

## Review round 2 (2026-09-05) — 11 findings, all addressed

- **B1 (HIGH, introduced by my own F5 fix)** Prisma's `mode: 'insensitive'` compiles to
  `"username" ILIKE $1` with the value bound raw, and `_` — which `USERNAME_PATTERN` allows — is a
  LIKE wildcard. Proven on real Postgres before fixing: `som_hai` refused (nobody holds it),
  `somchai_gmail.com` refused because it matched another user's EMAIL — an address-enumeration
  oracle on the one self-service route. Now an exact `$queryRaw` `lower("username") = $2`, and the
  email arm is **deleted** (L4: the charset forbids `@`, so it was dead and, under ILIKE, harmful).
  Every in-memory fake in the repo modelled that operator as equality and reported green, which is
  why this needed `account-profile-username.pg.spec.ts` — the repo's skip-without-DB idiom, gated
  on `ACCOUNT_PROFILE_TEST_DATABASE_URL`, registered in the fixed test list. The shared fake now
  **throws** on any `mode:` clause and answers the one raw query explicitly.
- **M1** the charset rejection was an uncoded English sentence; a Thai owner typing `สมชาย` got the
  generic fallback. Now `code: 'invalid_username'` with Thai copy, and the regex is mirrored
  client-side in `passwordFormError` with the same sentence. Both sides tested; the spec asserts
  the two regex copies are byte-identical.
- **M2** `buildIdentityPatch`'s `today` default and the VAT `effectiveFrom` used the UTC date while
  the server compares against `todayCivilDate(company.timezone)` — between 00:00 and 07:00 ICT that
  back-dated a CRITICAL-audited legal record by a day, silently. Both now use
  `todayCivilDate('Asia/Bangkok')` from contracts; tested with a fixed clock at 01:00 ICT.
- **L1** nothing invalidated the completeness cache after a save, so the item the owner had just
  completed kept reading as missing for up to 10 minutes. All four save handlers now clear it.
- **L2** the 7-day "ไว้ก่อน" was in `sessionStorage` and died with the tab. The dismissal moved to
  `localStorage` under its own key; the 10-minute answer cache stays per-tab.
- **L3 / L5** pinned: a REVOKED LINE identity is never told a password was set; an **unverified**
  email does not count as a login identifier.
- **N1** `route-permissions.ts`, `settings-menu.logic.ts` and the route file all use
  `COMPANY_PROFILE_SETTINGS_PATH` from contracts instead of three copies of the literal.
- **N2** `addressErrorMessages` mapped shape errors (`must be a string`, `is not an allowed field`)
  to "กรุณากรอก «label»", sending the owner to fix a box they had already filled. Only
  `is required` gets that sentence now; the rest get a neutral "ค่าไม่ถูกต้อง".
- **N3** the cross-module import of `normalizeThaiMobile` carries a one-line reason.

Reviewer confirmed correct, no action: F1, F2 (both sides), F3, F4, F6, F7, F8, the `setup.read`
widening, the relative-path contracts, and the force-dynamic route.

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

## Integration round (2026-09-05) — rebased onto L-C

Integration review of 4ded0fa3 passed. What the integration work consisted of:

- **`--onto` rebase, not a plain one.** `origin/codex/line-signup-c-admin` (5b811c28) is NOT a
  descendant of `origin/develop`: it branched at 74303618 and develop has since moved 34 commits
  ahead. `git rebase <L-C>` therefore replays 43 commits, dragging develop's L-A/L-A2/docs work
  into L-E and making `L-C..HEAD` 35 files. L-C already carries the L-A2 *code* through its own
  lineage; the develop-only content it lacks is docs (spec v4 +350, plan v2 +135, review round 1
  +112). So the rebase used `git rebase --onto origin/codex/line-signup-c-admin 74ccbb07`, which
  replays L-E's 11 commits alone. **L-C still needs its own rebase onto develop before merge.**
- Conflicts and how they were settled: `auth.controller.ts` keep both constructor params
  (`exchangeLiffSession` 28, `accountProfile` 29, `audit` 30); `apps/api/package.json` union of
  appended spec paths, verified by parsing (455 specs, 0 duplicates); the two pin files take
  either side then `node infra/security/sync-production-maintenance-release-pins.mjs`
  (validatorSha256 452265ed) — never hand-edit the SHA. `audit-action.ts`, `auth.module.ts` and
  `api-error-message.ts` auto-merged and were verified by parsing (L-C added 6 error keys, L-E 5,
  overlap 0).
- **`line-liff-signup.spec.ts` (L-C's) needed the same arity edit at two sites.** Both branches
  had independently grown a positional stub row from five entries to six; merged needs seven.
  Only `tsc` sees this — the suites run through tsx, which strips types without checking them, so
  `pnpm test` was green at 28 arguments where 29 are required. Its inline comment also claimed the
  LIFF fake was the last parameter before `audit`, true on L-C and wrong once `accountProfile`
  follows it.
- **Constructor-shape guard** added in `auth.controller.spec.ts`: it reads the parameter names out
  of the controller source and asserts arity 30 plus the six positions the positional stubs depend
  on (2 prisma, 11 changePassword, 13 notifyPasswordResetRequest, 15
  setAiAssistantPreferenceUseCase, 19 authRateLimit, 20 legalAcceptance). Verified against both
  failure modes: adding a parameter and swapping two.
- **pg-spec hardenings**: the holder is seeded `SomChai` (with a lower-case holder, dropping
  `lower()` still passed, because the desired name is lower-cased before the read), and the spec
  refuses any database not named `watchdog_bms` — localhost alone is not proof of a local
  database, because the production access recipe port-forwards prod to 127.0.0.1 over SSM.
- **`packages/contracts` must be rebuilt after checking out this head.** `packages/contracts/dist`
  is gitignored and untracked (`.gitignore:10`), so a fresh checkout has none and `tsc` reports
  ~24 false "has no exported member" errors against a stale or absent dist. Run
  `pnpm --filter @watchdog-bms/contracts build` first. This slice adds exports to
  `packages/contracts/src/company-profile.ts`, so it is the likely trigger.

**Counting note (my error, corrected here).** Earlier rounds of this doc claimed "api 8884 tests".
That number was produced by counting `.` characters in the dot reporter's output, which also
counts dots inside file paths, ellipses and decimals — it was never a test count. The measured
figure via the fixed list and the TAP reporter is 6450/6351/0/99. **Report per-workspace counts
only, from a reporter that prints its own totals — never an aggregate, never a character count.**

## Verification (after review round 2)

- Per workspace, never an aggregate (see the counting note below):
  | workspace | tests | pass | fail | skipped |
  |---|---|---|---|---|
  | `apps/api` (fixed list, 455 specs, DB present) | 6450 | 6351 | 0 | 99 |
  | `apps/api` (same list, `.pg.spec` skipping) | 6449 | 6350 | 0 | 99 |
  | `apps/web` | 1434 | 1434 | 0 | 0 |
  | `packages/contracts` | 206 | 206 | 0 | 0 |
  | `packages/config` | 138 | 138 | 0 | 0 |
- `pnpm -r typecheck` clean; `next build` clean, route still `ƒ`; pin sync `status=current`.
- `account-profile-username.pg.spec.ts` verified to **fail on revert** to the ILIKE version
  (`\`_\` is a LIKE wildcard: nobody holds som_hai`).
- **47 mutations, 47 caught, 0 escaped** — the 11 round-2 findings, the three the reviewer
  re-flagged (M6/M8/M12) and 30 round-1 regression guards. One escaped on the first sweep (N2's
  shape-error copy) and was closed.

## Verification (after review round 1, superseded)

- `apps/api` full fixed test list: 0 failures. New specs registered in
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
