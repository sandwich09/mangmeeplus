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

## Verification

- `apps/api` full fixed test list: green, 0 failures (new spec registered in `apps/api/package.json` — the only allowed edit there).
- `apps/web` suite: 1400/1400.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm -r typecheck`: clean.
- `apps/web` `next build`: clean; `/companies/[companyId]/settings/profile` listed `ƒ` (dynamic), confirming `force-dynamic`.
- Eight mutations proven caught — API: credential overwrite via upsert, dropped Thai-mobile validation, restored password demand, weakened permission key. Web: dropped tax-id legal-change rule, always-done checklist item, dropped `force-dynamic`, ungated dashboard card.

## Open questions / not done

- **§15.4 contextual modal at the tax-document issue point: not built.** The accounting-documents issuance path does not evaluate seller tax identity at all in this release — `company_tax_identity_incomplete` is thrown only from `completeCapture` — so a prompt there would fire on a condition nothing computes. The error message now names the new page instead. Revisit when issuance gains the Step 0 gate.
- **Email delivery is unproven end to end.** SES is in sandbox; the no-op mailers only log. The page says so in plain Thai rather than claiming a mail was sent. UAT must confirm a real delivery before this counts as a working recovery path.
- Account merge is a **link only**, per instruction. The `AccountMergeTicket` is minted only by the LINE OAuth `line_linked_elsewhere` path, so the taken-mailbox case sends the user to sign in with the existing account and link LINE there.
- Not exercised against a live database or a browser; no E2E path was added.

## Next

Push, open the PR against `develop` when asked, and put the profile page and the checklist card into the first UAT round alongside the L-B/L-C rehearsals.
