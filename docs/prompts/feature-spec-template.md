# Feature Spec Template

Copy this template when creating a new feature spec in `docs/specs/`.

# Feature: <Feature Name>

## 1. Status

- Roadmap/checklist item:
- Owner:
- Date:

## 2. Goal

Describe the business outcome, target user value, and why this belongs in WatchDog-BMS.

## 3. Source Docs

- Product/overview:
- Related specs:
- Related plans:
- Related ADRs:
- Permission matrix:

## 4. Non-goals

List what this feature will not cover in this phase.

## 5. User Roles

- Owner:
- Admin:
- Manager:
- Staff:
- Accountant or finance:
- AI assistant user:

## 6. Business Journey

1. Trigger:
2. Main user action:
3. System response:
4. Review or approval:
5. Completion state:
6. Exception path:

## 7. Business Rules

- Rule:
- Exception:
- Audit requirement:
- Approval or threshold:

## 8. Boundary and Ownership

- Web owns:
- LINE/LIFF owns:
- Backend/API owns:
- AI Gateway owns:
- Workers/notifications own:
- Out of boundary:

## 9. Data Model Draft

- Entity:
  - field:
  - lifecycle/status:
  - source of truth:

## 10. Permission and Audit

- Read permission:
- Create/update permission:
- Approve/export/admin permission:
- ABAC/ownership rules:
- Sensitive actions to audit:

## 11. API Behavior

- Endpoint or action:
- Permission:
- Validation:
- Success response:
- Error cases:
- Idempotency/concurrency:

## 12. UI Behavior

### Web

- Main screen:
- List/detail/form pattern:
- Loading/cover loader scope:
- Empty/error/forbidden/readonly states:
- Admin actions:

### LINE/LIFF

- AI question or alert:
- Summary response:
- Deep link to web:
- Permission/error state:
- Mutation boundary:

## 13. Edge Cases

- Case:
- Case:
- Case:

## 14. Acceptance Criteria

- [ ] Business journey matches product scope.
- [ ] Web/LINE/AI boundaries are explicit.
- [ ] Permission, audit, loading, error, and empty states are covered.

## 15. Test Cases

- Unit:
- Integration:
- UI:
- Permission:
- Edge case:

## 16. Open Questions

- Question:
