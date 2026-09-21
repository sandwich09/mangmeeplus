# System-wide User-facing Error Copy Spec

Status: COMPLETE — DEFAULT-OPEN FEATURES ONLY
Date: 2026-09-21
Owner: web/platform
Related:
- `docs/qa/system-error-message-audit-2026-09-21.md`
- `docs/specs/user-facing-error-message-safety-spec.md`

## Goal

Every API failure shown by a default-open customer feature must use plain, honest Thai that tells
the user what happened and what to do next. Unknown errors must remain safe without claiming an
incorrect cause.

## Rules

1. Keep the existing resolution order: stable code, reviewed exact/pattern message, then status or
   kind fallback. Never display an unreviewed API message directly.
2. A known business rule must use a stable code and reviewed customer copy. Dynamic, bounded values
   may be carried in `details` and rendered only by reviewed logic.
3. Unknown 400/422 copy must not claim that the screen and API are incompatible. It tells the user
   to check entered data or the current condition of the item.
4. Unknown 409 copy must cover both concurrent changes and a state that no longer permits the
   action. It must not claim that another user edited the item unless a specific code proves that.
5. Unknown 503 copy must say that a required service is unavailable. It must not claim maintenance
   or load when configuration/provider readiness may be the cause.
6. Permission fallback names a relevant administrator, not always the shop owner.
7. Field-specific validation belongs next to the field when the client has a stable field contract;
   business/state failures remain a persistent banner or existing toast.
8. Specialist terms may remain only on specialist routes and must be paired with a Thai recovery
   action.

## Acceptance Criteria

- [x] The confirmed branch, duplicate tax ID, invalid sale price, closed period, tax review,
  notification retry, and billing readiness cases have specific Thai copy when their feature is
  default-open.
- [x] Unknown 400, 409, 422, and 503 errors use neutral, actionable Thai and expose no raw message.
- [x] Source-derived coverage includes the feature families in `DEFAULT_ENABLED_FEATURE_KEYS`, plus
  billing/renewal flows, including approved domain translators. Public signup/onboarding is closed
  and excluded from this implementation.
- [x] Adding a new covered stable code without reviewed copy fails a focused test.
- [x] Existing raw-message, persisted-diagnostic, and successful-response guards remain green.
- [x] No dependency, schema, permission, or business-rule behavior changes.

## Verification

- Focused shared renderer and source-derived coverage tests.
- Focused feature/domain tests for changed local translators.
- Web typecheck and `git diff --check`.
- Authenticated browser verification is recorded separately when a runtime is available.
