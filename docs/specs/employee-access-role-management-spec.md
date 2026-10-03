# Employee Access and Role Management Spec

## 1. Status

Ready for implementation handoff. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 10C.

Linked plan: [[plans/employee-access-role-management-plan|Employee Access and Role Management Plan]]

## 2. Goal

Let a customer `OWNER` or authorized company `ADMIN` create employee access for web and LINE AI from Settings:

1. Open Settings > Employees.
2. See employee list and create button.
3. Create employee with name, Thai national ID or passport, phone number, and role.
4. System creates web user access, one-time temporary password, company membership, and role assignment.
5. System generates a QR/account-link package so the employee can bind LINE.
6. Employee logs in to web, links LINE, and uses only assigned permissions in web and LINE AI.

This is access provisioning, not payroll/HR compliance. Payroll employee master, compensation, leave, tax, and social security stay in item 20.

## 2.1 Business Context

As SMEs grow beyond the owner, the owner needs a controlled way to let employees use WatchDog-BMS without sharing owner credentials. The business outcome is simple: each employee gets their own login, role, and LINE AI access that matches their job.

Primary business cases:

- Owner creates access for a new cashier, sales staff, warehouse staff, finance user, accountant, or manager.
- Admin assigns a role that matches the employee's work, such as sales-only, inventory-only, finance, accountant, staff requester, or read-only auditor.
- Employee receives a temporary password for web and a QR/link package for LINE account linking.
- Owner can later suspend the employee, change their role, or regenerate credentials.
- LINE AI answers only what that employee is allowed to see.

## 3. Non-Goals

- Payroll, salary, leave, benefit, bank account, social security, or tax profile management.
- Public employee signup, email/SMS delivery, bulk import, or support impersonation.
- LINE role, permission, password, employee-status, or account-link-token mutation.
- Storing generated passwords, full ID/passport, QR tokens, or LINE tokens in plaintext logs/audit.
- Permission grants outside active company feature entitlement.

## 4. Boundary and Ownership

Reuse Auth/RBAC and LINE primitives:

- `User`, password credential, `CompanyMembership`, `Role`, `Permission`, `RolePermission`, `MembershipRole`.
- Request context, permission decorators/guards, audit service, and password hashing/verification.
- `ExternalIdentity`, account-link verification, and selected-company context.

Employee Access owns only the missing customer-side access workflow:

- Employee access profile fields required for provisioning and contact lookup.
- Settings > Employees list/detail/create/edit.
- Settings > Roles list/detail/create/edit.
- One-time password handoff package.
- Short-lived QR/account-link package.

## 5. Data Requirements

Add only the missing company-scoped access profile if current code has no equivalent:

```text
EmployeeAccessProfile
- id
- companyId
- userId
- membershipId
- displayName
- legalName nullable
- identityType: THAI_NATIONAL_ID | PASSPORT
- identityLast4
- identityEncryptedRef
- phoneNumber
- status: DRAFT | INVITED | ACTIVE | SUSPENDED | DISABLED
- createdByUserId
- updatedByUserId
- createdAt
- updatedAt
```

Sensitive identifier rules:

- Store Thai national ID/passport through the existing encrypted/vault field pattern where available.
- Return masked values by default, such as `*********1234`.
- Never write full ID/passport, generated password, QR token, or LINE account-link token to audit metadata or logs.

## 6. Role Management

First pass supports:

- List roles and permissions.
- Create/edit/disable company custom role.
- Select permissions from the registered permission catalog.
- Assign roles to an employee membership.

Rules:

- Protected system roles cannot be deleted, renamed by key, or weakened through customer UI.
- Last active `OWNER` membership cannot be disabled, demoted, or stripped of owner-level access.
- A user cannot remove their own last role-management permission unless another active owner remains.
- Employee create/update may grant only roles whose permission set is a subset of the granter's current effective permissions; `OWNER`, `SYSTEM_ADMIN`, and `COMPANY_VIEW` remain outside the employee-provisioning allowlist.
- The `HR` system role is the bounded exception: `access.role.operational.assign` may grant only `MANAGER`, `SALES`, `INVENTORY`, `MARKETING`, and `STAFF`, as specified in [[specs/employee-job-title-and-hr-role-delegation-spec|Employee Job Title and HR Role Delegation]].
- A user cannot mutate their own employee role assignment. `FINANCE` and `ACCOUNTANT` assignment additionally requires `access.role.financial.assign`, which is granted to `OWNER` only as the current step-up approval boundary.
- Role grants must be limited to permission keys enabled by the company's feature entitlement.
- Every role/permission change is audited with granter, grantee, and added/removed role IDs.

## 7. Password and QR Handoff

Web credential handoff:

- Generate temporary password only when creating an employee or explicitly regenerating credentials.
- Store password hash only, plus (2026-07-08 owner decision) an AES-256-GCM encrypted copy of the CURRENT system-generated temporary password (`UserCredential.tempPasswordEncrypted`, `CREDENTIAL_ENCRYPTION_KEY`) so a system admin can re-reveal it from the partner member console; the encrypted copy is deleted the moment the user changes the password themselves, and every reveal is audited (`system.partner_member.password.reveal`, CRITICAL).
- Return the generated password once.
- Default `mustChangePassword=true`.
- Default temporary password expiry: 72 hours.

LINE account-link QR:

- QR encodes a short-lived LIFF universal link (`https://liff.line.me/<LIFF_ID>/employee?token=...`) when LIFF is configured, with a direct same-origin link-page fallback for local development; it never contains a password or permission snapshot.
- Token binds to `companyId`, `membershipId`, intended `userId`, issuer, expiry, and nonce.
- Token is single use; default expiry is 15 minutes. Re-scanning a used token with the LINE account it already linked returns idempotent success (no state change); any other LINE account gets the generic token failure.
- Employee creation auto-issues one QR package and returns it in the one-time credential handoff; owner can re-issue from employee detail if it expires.
- Company onboarding issues the same token shape for the first owner with a 72h expiry matching the temporary-password handoff window.
- Linking succeeds only after verified LINE Login/LIFF identity and active membership check.
- After a successful link (including the idempotent re-scan) the link page deep-links into the system LINE OA chat (`https://line.me/R/ti/p/{basicId}` from bot info), so LINE opens and prompts add-friend when the user is not a friend yet; when bot info is unavailable the page falls back to the plain success message.
- Existing `ExternalIdentity` and selected-company context remain source of truth.

## 8. Web UX

Navigation:

- Settings > Employees
- Settings > Roles

Employees list:

- Name, phone, masked ID/passport, role chips, status, web credential state, LINE link state, and last login/link timestamps when available.

Create employee:

- Name, Thai national ID or passport, phone, descriptive job title, and system role. Job title never grants permission.
- Moving into the credential-handoff step creates `User`, membership, employee access profile, role assignment, temporary password, and optional QR/account-link package as `DRAFT`; a draft membership is not authorized for web, LINE, or AI access.
- Pressing **Finish** atomically changes both profile and membership to `ACTIVE` while keeping the credential-handoff screen visible; only then does the screen expose the LINE QR for scanning.
- Re-entering the same Thai ID/passport while its company record is still `DRAFT` resumes and refreshes that draft instead of returning a duplicate conflict. The same identifier on any non-draft employee remains a blocking conflict.

Employee detail:

- View masked profile.
- Update name, phone, and role.
- Disable/suspend membership.
- Regenerate temporary password.
- Generate LINE link QR.

Roles:

- Role list.
- Create/edit custom role.
- Permission picker grouped by module.
- Protected system roles visible but not destructively editable.

## 9. API and Permissions

First-pass endpoints may live under existing auth/access-control modules if that is the smallest fit:

```text
GET    /v1/settings/employees
POST   /v1/settings/employees
POST   /v1/settings/employees/:employeeId/complete
GET    /v1/settings/employees/:employeeId
PATCH  /v1/settings/employees/:employeeId
POST   /v1/settings/employees/:employeeId/disable
POST   /v1/settings/employees/:employeeId/credentials/regenerate
POST   /v1/settings/employees/:employeeId/line-link-token

GET    /v1/settings/roles
POST   /v1/settings/roles
GET    /v1/settings/roles/:roleId
PATCH  /v1/settings/roles/:roleId
POST   /v1/settings/roles/:roleId/disable
GET    /v1/settings/permissions
```

Use permission keys from [[specs/permission-matrix|Permission Matrix]]:

```text
access.employee.read
access.employee.create
access.employee.update
access.employee.disable
access.employee.credential.issue
access.employee.line_link.issue
access.employee.line_link.revoke
access.role.read
access.role.manage
access.role.operational.assign
access.role.financial.assign
access.permission.read
```

All endpoints must use server-derived company context and active membership checks.

## 10. LINE and AI Rules

LINE can:

- Complete account linking through verified LIFF/Login.
- Confirm link success/failure.
- Use LINE AI read tools according to the linked employee's current permissions.
- Deep-link the employee to web pages they are allowed to access.

LINE and AI cannot:

- Create employee users.
- Change passwords.
- Generate credential packages.
- Create/edit roles.
- Assign permissions.
- Disable users.
- Reveal hidden employee identifiers or permission catalogs beyond the user's permission.

AI Gateway must call permission-checked APIs/tools only. It must not directly query auth/RBAC tables.

## 11. Audit Requirements

Always audit employee create/update/disable/suspend, temporary password generation/regeneration, LINE link token generation/revocation/success/failure, role create/update/disable, role permission grant/revoke, employee role assignment changes, and last-owner/self-demotion blocks.

Audit metadata must not contain generated password, QR token, full ID/passport, or LINE token.

## 12. Acceptance Criteria

- Owner/Admin can create an employee from Settings > Employees with name, Thai ID/passport, phone, and role.
- Before the wizard is finished, the system stores the employee profile and membership as `DRAFT`; draft membership never resolves as active access.
- Repeating create with the same company + identity resumes the existing draft without creating a second user/profile; an active or otherwise non-draft identity still returns a duplicate conflict.
- Pressing Finish atomically activates the employee profile and `CompanyMembership`.
- The Thai Add Employee wizard uses the established Thai term for username and the existing Thai wording for a draft. Date guidance uses Thai words rather than machine format examples.
- Temporary password is shown once, stored only as a hash, expires, and requires change.
- QR/account-link token links LINE only after verified identity and active membership check.
- Employee can use web and LINE AI only within assigned permissions.
- Owner/Admin can create and manage custom roles from Settings > Roles.
- Protected system roles and last active owner protections work.
- Missing permission returns `403`.
- Disabled membership immediately loses web, LINE, deep-link, notification detail, upload, and AI tool access.
- Sensitive identifier, generated password, and QR token never appear in logs/audit/API list responses.

## 13. Owner Update 2026-07-06 — Birthdate Temporary Password

Supersedes the temporary-password rules above for newly created employees:

- Employee creation collects `birthDate` (new profile field).
- The generated initial password is the employee's date of birth as eight digits, in day-month-Gregorian-year order with no separators.
- The new credential is created with `mustChangePassword=true`, so the employee must set a new password at the first sign-in with it; the wizard tells the owner so. (Corrected 2026-10-03: this line used to say the change was not forced, while `create-employee.use-case.ts` has forced it since the 2026-08-07 import. The code is the rule. An employee added from an account they already have keeps their own password.)
- The birthdate initial password does not carry the 72-hour expiry of the old random flow (`expiresAt=null`), so an employee who first signs in late is asked to change it, not locked out. Owner accepted the weaker-credential risk of a birthdate password on 2026-07-06.
- Existing protections stay: login rate limiting/lockout, password never in logs/audit/list responses (a birthdate password is also PII), and employees can still change their password themselves.
- Acceptance criterion "Temporary password is shown once, stored only as a hash, expires, and requires change" applies to the birthdate flow only as "stored only as a hash" and "requires change".

## 14. Owner Update 2026-07-11 — Draft Employee Provisioning

- The credential-handoff screen is not completion. Creating the backing records before that screen must use `DRAFT`, not `ACTIVE`.
- Closing the wizard before Finish leaves a visible, non-authorized draft.
- Starting again with the same company + Thai ID/passport resumes that draft and refreshes its pending credential/LINE-link package; it must not fail as a duplicate.
- Finish is the only wizard action that transitions `DRAFT` to `ACTIVE`.
- Employee lists and individual-access detail show a visible `Draft` badge for unfinished employees.
- The individual-access three-dot menu provides employee profile editing; draft profile data remains editable.
- Employee editing reuses the same four-step journey as Add Employee: personal data, contact/address, role/branches, and completion. All Add Employee fields are editable, including replacing the Thai ID/passport; the existing identity is returned only as a masked value, and any replacement is duplicate-checked, hashed, and encrypted before storage.
- Province, district, and subdistrict are persisted with the employee profile instead of being UI-only address fields.
- The contact/address step looks up the canonical `ThaiAddressMaster` by five-digit postal code and offers linked province, district, and subdistrict choices. If the master has no matching row, the form keeps a free-text fallback so legacy or exceptional addresses remain editable.
- Account status controls are disabled for drafts, and the status API must reject every transition out of `DRAFT`; only the wizard Finish endpoint may activate a draft.

### Draft removal — 2026-08-27

- The employee menu removes an unfinished draft through a dedicated draft-delete action, not a transition to `DISABLED`. After reload the draft is absent and cannot be reopened or finished.
- Reuse `access.employee.disable` and the existing owner/platform and people-manager protections. The final transaction must check company ownership and both profile/membership draft state; a concurrent Finish must never allow deletion of an activated employee.
- Remove only this company's draft profile, membership, role assignments and branch scopes; revoke its pending LINE-link tokens and retain a deletion audit. Preserve the global user, credential, external identities, sessions and all other-company records. Non-draft disabling remains unchanged.
- Draft resume, Finish, token issue and credential issue must serialize with removal and recheck existence before writing. No pending token or credential reset may be issued for a draft already removed.
- Freed company identity/phone values can be reused. The preserved login still follows existing-account confirmation and the existing distinct company-email requirement; removal neither silently attaches an account nor resets its password.
- Confirmation/success text must describe draft removal and retained login accurately. Stale/deleted drafts return actionable not-found feedback; newly activated employees return a draft-specific conflict, not a misleading concurrent-update message.

## 15. Owner Update 2026-08-29 — One Role per Employee

Employee create/role replacement selects exactly one role. Extra capabilities belong in the existing role-permission editor, not another employee role assignment. Keep job title descriptive and separate; show the saved role consistently in the employee header, list and permission summary. Existing grant, self-change, protected-role, branch and audit rules remain. See `docs/specs/employee-single-role-spec.md` for acceptance and the legacy-data transition boundary.
