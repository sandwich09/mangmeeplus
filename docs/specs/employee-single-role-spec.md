# Employee single-role assignment

## Status and goal

Owner requested 2026-08-29: one employee holds one role at a time; an authorized manager can replace it. Additional capabilities are configured in the existing Roles and Permissions page, not by stacking roles. This supersedes multi-role employee assignment in the earlier employee-access specs.

## Journey and rules

- Add/edit and employee overview offer a single selected role. Selecting another replaces the previous assignment; selecting the same role is a no-op, not removal.
- The employee header, list card, role picker and permission summary show the same saved role immediately after success. A failed save does not display an unsaved role.
- Job title remains a separate descriptive field; role changes never overwrite it. The header explicitly shows the saved role next to the employee name.
- API create/update accepts the existing roleIds array with exactly one entry when supplied. Empty, duplicate or multiple entries are rejected before mutation. Omitted roleIds on profile-only updates leaves access unchanged.
- Reuse existing company context, grantability, HR boundaries, self-change/OWNER protections, branch-scope rules and audit. No new permission or per-user permission editor.
- The existing Roles and Permissions page remains the route for extra capabilities; its UI must explain that a role's permissions affect everyone using that role.
- Do not silently choose or revoke roles on existing multi-role records. Keep them accurately visible with a warning until an authorized user explicitly selects one. This legacy transition policy was sent to the owner for confirmation; do not run a bulk migration without approval.

## Architecture and boundaries

- Preserve the wire shape and MembershipRole table; one-role validation at HTTP and use-case boundaries covers create, draft resume, cross-company attach and update.
- Existing transactional replacement keeps one selected role, without a schema migration or role hierarchy guess.
- UI consumes the successful employee response to refresh every employee card, then refreshes role/permission projections. Server-provided grantability remains authoritative.
- Reimbursement UAT status investigation and financial data repair are separate from this feature. No live account/permission changes as part of implementation.

## Acceptance evidence

Tests must cover rejected multi-role create/update, valid replacement, profile-only updates, existing security guards, UI single selection and persisted header/list/permission agreement. Test on the existing local server; retain failed-save/read-only paths. See the linked plan and task memory for commands and results.

Plan: `docs/plans/employee-single-role-plan.md`.
