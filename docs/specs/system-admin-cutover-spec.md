# System Admin Cutover Spec

Status: Approved for implementation by repository owner on 2026-08-25.

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


## Decision register: COMPANY-TEAM-NOTE — 2026-10-04

เจ้าของตัดสินใจให้เก็บหมายเหตุทีมมั่งมีหนึ่งรายการต่อบริษัท อ่าน/แก้จากคอนโซลและรายงานผู้บริหารให้ตรงกัน. การ์ดในภาพรวมบริษัทของผู้ดูแลใช้ `GET/PUT /v1/system/partners/:partnerCompanyId/team-note`, ส่งเวอร์ชันที่อ่านมา; ผู้ดูแลแก้ได้ทุกสถานะบริษัท ร้านไม่เห็นข้อมูลนี้. ช่องสิทธิ์เสริม `canManageCompanyNote` ในคำสั่งสร้าง/แก้บัญชีผู้บริหารให้สิทธิ์ `system.executive.company_note.manage` ผ่าน role เสริม ค่าเริ่มต้นปิด

[สเปกหลังบ้าน COMPANY-TEAM-NOTE](mangmee-executive-business-backend-spec-th.md#decision-register-company-team-note--2026-10-04) เป็นกติกากลางด้านข้อความ เวอร์ชัน audit และ cascade; [สเปกหน้าจอ](mangmee-executive-business-ui-spec-th.md#decision-register-company-team-note--2026-10-04) ระบุสถานะการ์ด. หลักฐานและงานตรวจรับค้างอยู่ที่ `docs/agent-memory/company-team-note-2026-10-04.md`
