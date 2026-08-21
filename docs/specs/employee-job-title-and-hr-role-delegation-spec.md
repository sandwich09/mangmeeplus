# Employee Job Title and HR Role Delegation Spec

## Status

Approved for implementation on 2026-08-21.

## Goal

Remove the misleading coupling between an employee's job position and their system access. The employee wizard must capture both concepts explicitly:

- `jobTitle`: the person's company-visible job title, such as `เจ้าหน้าที่บุคคล`, `พนักงานขาย`, or `หัวหน้าคลัง`.
- system role: the RBAC role that controls what the person can do in WatchDog-BMS.

Add an `HR` system role so an owner can delegate routine employee administration without delegating owner, platform-admin, finance, accounting, audit, or role-administration authority.

This remains access provisioning. Payroll, compensation, leave, tax, and statutory HR data remain out of scope.

## Users and Journey

1. An owner assigns the `HR` system role to an employee.
2. HR opens Employees and creates or updates an employee profile, including a free-text job title.
3. HR assigns one routine system role from the server-provided assignable-role list.
4. The server rejects any privileged role assignment even if a client submits it directly.

## Rules

- A job title is descriptive only and never grants permission.
- One job title may be used by any number of employees.
- `jobTitle` is a trimmed free-text value, maximum 120 characters. A role/job-title catalog is not introduced in this slice.
- Existing employee records may have no job title; the add/edit wizard requires it when the record is saved through the new UI.
- `HR` may read, create, update, suspend, and disable employee access profiles.
- `HR` may assign only these unchanged built-in system roles: `MANAGER`, `SALES`, `INVENTORY`, `MARKETING`, and `STAFF`. A company override/custom role that reuses one of those keys is not assignable by HR.
- `HR` may not assign `OWNER`, `SYSTEM_ADMIN`, `COMPANY_VIEW`, `ADMIN`, `HR`, `FINANCE`, `ACCOUNTANT`, `AUDITOR_READONLY`, or custom roles.
- HR may edit descriptive profile fields for a privileged employee, but may not change that employee's existing privileged, financial, audit, HR, platform, or custom role.
- Only an owner may assign `HR` under the existing permission-subset rule.
- Self-role changes remain forbidden.
- HR employee administration is company-wide, so an HR membership uses all-branch scope.
- The server is the source of truth for assignable roles; the web role picker only renders roles with `assignableByCurrentUser=true`.

## UX Requirements

- Rename role-facing labels from “ตำแหน่ง” to “บทบาทและสิทธิ์ระบบ”.
- Add a distinct “ตำแหน่งงาน” field before role selection.
- Keep the step action named “ถัดไป” and validate the current step before navigation.
- Put the error next to the invalid field, focus that field, and state exactly what is missing or invalid.
- Do not show the removed text “1 คน มีได้ 1 ตำแหน่ง”.

## Acceptance Criteria

- Two employees can save the same `jobTitle`.
- Changing `jobTitle` does not change permissions.
- HR can create/update an employee and assign each allowed operational role.
- Direct API attempts by HR to grant a forbidden, financial, privileged, HR, or custom role return `403`.
- Direct API attempts by HR to demote or replace an existing forbidden role also return `403`; the UI renders that role read-only.
- The HR role itself does not receive finance/accounting/audit or custom-role-management permissions.
- Owner retains the ability to assign all valid non-platform employee roles, including HR.
- Employee list/detail/wizard clearly distinguish job title from system role.
- Existing employees without `jobTitle` remain readable.
