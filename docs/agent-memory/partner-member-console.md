# Agent Memory: partner-member-console

Status: Implemented + live-verified locally; deploying to prod
Owner: thawtchai + Claude
Scope: System-admin Members console inside Partner detail (`/system/partners/[id]`): list company members (owner + employees) with username, roles, LINE link state, and credential state; actions = reveal temporary password (eye icon), reset password, unlink LINE. Requested 2026-07-08 after the LINE relink round-2 test (admin previously had to unlink via browser-console fetch).

Decisions:
- Passwords users chose themselves are hashes and can never be displayed. What the eye icon reveals is the CURRENT system-generated temporary password, now stored as an AES-256-GCM encrypted copy in new column `UserCredential.tempPasswordEncrypted` (key = existing `CREDENTIAL_ENCRYPTION_KEY`, cipher = system-partner-management `credential-cipher.logic`). Owner explicitly accepted this trade-off (same spirit as the 2026-07-06 birthdate-password decision).
- Encrypted copy is written at all four generate sites (system-onboarding create + regenerate, employee-access create + regenerate, partner member reset) and DELETED at both self-change sites (`change-password`, `confirm-password-reset`) — present ⇒ still the system-issued password.
- Members with no `UserCredential` row (e.g. dev-token-only seed users) return `credential: undefined`; UI disables Reset and shows "—" for password.
- New permissions `system.partner_member.read` (HIGH) + `system.partner_member.manage` (CRITICAL), granted to SYSTEM_ADMIN via ROLE_GRANTS; `prisma/sync-permissions.ts` runs on every prod boot so keys self-seed on deploy.
- Every reveal is audited (`system.partner_member.password.reveal`, riskLevel CRITICAL, metadata without the password). Reset = `...password.reset`, unlink = `...line_unlink` (HIGH).
- Admin unlink severs the member's LINE for ALL companies (ExternalIdentity is user-global) — same semantics as self-service unlink; relink works because link-line-identity reactivates UNLINKED rows (fix `4b99295b`).
- Routes live on PartnerController under `:partnerCompanyId` (NOT `:companyId` — auth guard treats companyId param as tenant scope; system admins have no customer membership).

Artifacts:
- apps/api/prisma/migrations/20260707160000_user_credential_temp_password/ (+ schema.prisma, generated client)
- apps/api/src/modules/system-partner-management/application/use-cases/{list-partner-members,partner-member-line-unlink,partner-member-password-reset,partner-member-password-reveal}.use-case.ts (+ module, partner.controller.ts routes GET members / POST line-unlink / POST password/reset / POST password/reveal)
- apps/api/src/modules/auth/permission-registry.ts (2 new keys + SYSTEM_ADMIN grants)
- Temp-password storage touches: create-company-onboarding, regenerate-temporary-password, create-employee, regenerate-employee-credential; clearing: change-password, confirm-password-reset
- packages/contracts/src/partner-management.ts (PartnerMemberDto, PartnerMembersDto, PartnerMemberPasswordResetDto, PartnerMemberTempPasswordDto)
- apps/web/src/features/system-partners/system-partners.api.ts (4 fetchers) + PartnerDetailPage.tsx (MembersSection + EyeIcon, inserted between Identity and Feature Entitlements)
- docs/specs/employee-access-role-management-spec.md §7 (encrypted temp-password copy rule)

Verification (2026-07-08):
- Unit: partner-member-console.use-cases.spec.ts 8/8 (cipher roundtrip, 404-no-copy, 404-bad-key, audit without plaintext, unlink, list mapping without blob leak); partner.controller.spec + create-company-onboarding.spec + create-employee.spec updated → 37/37 with new constructor args; api+web typecheck, contracts build clean.
- Live local (:3101, system-admin dev token): GET members 200 (roles+lineLinked correct); reset 200 → reveal returned the EXACT same password; members then showed credential {TEMPORARY, mustChangePassword, hasTempPassword:true}; unlink 200; plain OWNER token → 403; audit rows for all three actions contain no password; member without credential → clean 404s.
- Local migration applied via prisma migrate deploy; sync-permissions upserted 310 perms/1189 grants.

Open questions / next:
- Browser-path pass of the Members section on prod after deploy (table renders, eye reveal, confirm dialogs).
- Old QRs from pre-fix companies: owner temp passwords issued BEFORE this deploy have no encrypted copy (eye shows "—" until reset/regenerate).
- Consider a customer-facing (OWNER-scoped) version in Settings > Employees later; current console is system-admin only.
