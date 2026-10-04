# System Admin Cutover Spec

Status: Approved for implementation by repository owner on 2026-08-25.

## Global WHT catalog administration — owner decision 2026-10-04

SYSTEM_ADMIN alone receives `system.wht_income_category.manage` through the permission registry and the existing permission sync. `/system/wht-income-categories` is linked under “ตั้งค่าระบบ” only with that permission; direct visits require it too. `GET /v1/system/wht-income-categories` lists name, form, rate and status; `PATCH /v1/system/wht-income-categories/:code` accepts only ACTIVE or DRAFT. Both require the platform tenant in addition to permission. No shop role receives this key; `tax.config.manage` cannot change the global catalog.

The page offers enable/disable with a Thai confirmation naming the category/form/default rate and its effect on new selections and later 50 ทวิ. Certificates copy the saved source rate (which AP can override), rather than enforcing the catalog default; the exact requested default-rate promise needs the owner clarification recorded in `wht-certificate-system-issuance-spec.md`. Name and rate are read-only. The existing status use case writes a HIGH audit with the platform actor, old/new statuses, rate and form. The initial 12 ACTIVE / 3 DRAFT catalog and preservation rules are defined in that spec (2026-10-04 decision). No live environment operation is part of this implementation lane.

## Goal

Allow the sole repository owner to replace an application `SYSTEM_ADMIN` in Production without opening a broad interactive database writer or weakening the existing protected-principal triggers.

## Users and journey

The repository owner dispatches one constrained GitHub Actions workflow from protected `main`:

1. `ADD` verifies an exact successful UAT Release Passport, uses its signed immutable API release-task image, creates a fresh platform-only account with a temporary password, and proves password login plus `SYSTEM_ADMIN` resolution before logging the verification session out.
2. The owner reads the temporary password directly from AWS Secrets Manager, signs in, and changes it. The password never appears in Actions logs or artifacts.
3. `REVOKE` verifies the replacement account is active, has changed its temporary password, and resolves `SYSTEM_ADMIN`; it then disables the old credential and revokes every active old session. The owner-side command immediately rotates the temporary secret to an unusable tombstone value after the signed evidence passes.

## Rules and boundaries

- Production only; no runtime service deployment and no customer-gate mutation.
- Controller must be the current protected `main`, dispatched by the repository owner, under the existing `watchdog-bms-production-deploy` concurrency group.
- Executor image must come from one exact, unexpired, successful signed UAT Release Passport and pass signature/source verification.
- `ADD` accepts a fresh username only. It must not overwrite an existing user or credential and must create only the permanent มั่งมีพลัส · ระบบภายใน membership with `SYSTEM_ADMIN`.
- `ADD` always sets `mustChangePassword=true` and writes one high-risk audit record without credential material.
- `REVOKE` fails unless the replacement credential is active with `mustChangePassword=false` and the replacement has an active มั่งมีพลัส · ระบบภายใน `SYSTEM_ADMIN` membership.
- `REVOKE` disables the old credential and revokes active sessions in one transaction. The protected user and protected role row remain for historical integrity.
- Both operations are idempotent only for their exact audit request id; a different request against an existing target fails closed.
- No password, access token, refresh token, database URL, secret value, or password hash may appear in logs, outputs, task environment values, artifacts, or repository files.
- The fixed temporary secret is provisioned from the owner's authenticated workstation. The GitHub controller can describe its ARN but cannot read or write its value.
- The temporary password reaches the task only as an ECS secret reference. The workflow may output the secret id, never its value.

## Acceptance criteria

- Focused tests prove input rejection, fresh add, replay, replacement-readiness refusal, revoke, and revoke replay.
- Rendered release-task definitions contain only the two approved commands and secret references; malformed usernames, modes, environments, secret ARNs, or missing approval references fail before registration.
- `ADD` evidence names the environment, operation, username, user id, role, result, request id, and source commit without secrets.
- Live Production login returns `passwordChangeRequired=true`, redirects to `/system/platform-access`, `/v1/auth/me` includes `SYSTEM_ADMIN`, and the verification session is logged out. Signed ADD evidence records this without tokens.
- After owner password change, `REVOKE` evidence shows the old credential disabled and zero active old sessions.
