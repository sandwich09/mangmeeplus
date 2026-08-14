# User-Facing Error Message Safety — Implementation Plan

Status: COMPLETE
Date: 2026-08-15
Spec: `docs/specs/user-facing-error-message-safety-spec.md`
Memory: `docs/agent-memory/user-facing-error-message-safety.md`
Mode: ponytail full — fix the shared display seam first, reuse existing mappings, add no dependency.

## 1. Current State

- `apps/web/src/common/api/authed-fetch.ts` joins NestJS validation arrays into a raw thrown
  `Error.message`; mutation failures then pass that error to the global toast bus.
- `apps/web/src/common/api/api-error-message.ts` already provides code, exact-message,
  parameterized-message, and selected status mappings. Unknown API text currently passes through.
- `apps/web/src/common/api/api-error.logic.ts` and
  `apps/web/src/common/i18n/error-message.logic.ts` form a second client path. It uses
  `statusCode`/`kind` and generic localized fallbacks, so both clients must remain semantically
  aligned.
- Multiple mounted features still assign API `.message` directly to error UI. Representative gaps
  include substitute-receipt settings, branch settings, dashboard notifications, account security,
  CRM inbox/LINE OA, data rights, and system partner pages.
- Persisted workflow/delivery error strings can also reach UI independently of a thrown HTTP error.
- The current E2E error toast fixture supplies an already-Thai 500 message, so it cannot detect the
  reported validation leak.

## 2. Smallest Correct Architecture

```text
API/network failure
  -> retain raw Error/code/details/requestId
  -> shared customer-message renderer
       code map
       -> reviewed message map/pattern
       -> status/statusCode/kind Thai fallback
  -> existing owner: toast OR inline/load state
```

No new error class, translation package, toast system, or backend response format is needed.

## 3. Phase 1 — Close the Shared Renderer

Primary files:

- `apps/web/src/common/api/api-error-message.ts`
- `apps/web/src/common/api/api-error-message.spec.ts`
- `apps/web/src/common/api/api-error-coverage.spec.ts` only when a coverage assertion belongs there

Work:

1. Preserve the existing priority: stable code, exact message, parameterized message.
2. Recognize both `status` and `statusCode`, plus the existing API error kinds.
3. Detect API-shaped unknown errors from status/code/kind/details and return the canonical fallback
   in spec §6 instead of returning the original message.
4. Treat a caught fetch/network exception as the canonical network failure.
5. Keep reviewed, non-API local UI messages unchanged.
6. Do not delete the raw message/details or add logging inside the renderer.

Focused checks:

- exact reported `property visibility should not exist` case;
- unknown validation array;
- stable-code priority;
- `statusCode`-only error;
- `Internal server error`;
- network error;
- no raw framework token/snake-case leakage.

## 4. Phase 2 — Complete Shared Client Coverage

Primary files:

- `apps/web/src/common/api/authed-fetch.ts`
- `apps/web/src/common/api/authed-fetch.spec.ts`
- `apps/web/src/common/api/api-error.logic.ts` and its spec only if alignment requires a change
- `apps/web/src/common/i18n/error-message.logic.ts` and its spec only if alignment requires a change

Work:

1. Keep the parsed response body, raw validation array, `code`, and `requestId` in error details.
2. Ensure a network rejection from a mutating `authedApiFetch` call emits exactly one friendly error
   event before rejection.
3. Keep GET failures free of automatic toast emission.
4. Keep `suppressErrorToast`, legal/session redirect recovery, CSRF retry, and access-context events
   unchanged.
5. Confirm `statusCode`/`kind` errors from the legacy client resolve to the same customer copy.

Do not change the API pipe or normalize NestJS validation arrays on the server.

## 5. Phase 3 — Remove Direct Display Bypasses

Search all mounted web features, not only the original substitute-receipt journey. Start with:

- `apps/web/src/features/expenses/SubstituteReceiptSettingsPage.tsx`
- `apps/web/src/features/expenses/expenses.model.ts`
- `apps/web/src/features/branch-settings/BranchSettingsPage.tsx`
- `apps/web/src/features/dashboard-notifications/NotificationPages.tsx`
- `apps/web/src/features/auth/auth.logic.ts` and account-security callers
- `apps/web/src/features/tax/transaction-tax.model.ts`
- `apps/web/src/features/crm-inbox/`
- `apps/web/src/features/system-data-rights/`
- `apps/web/src/features/system-partners/`
- other mounted feature matches found by the source guard

For each customer-visible use:

1. route the error object through `apiErrorMessage`, `localizedErrorMessage`, or a domain renderer
   that consults the shared map first;
2. keep reviewed domain-code copy ahead of the generic fallback;
3. leave non-display branching on code/details intact;
4. avoid adding `toast.error` where `authedApiFetch` already owns mutation failure feedback;
5. keep an inline error only when it provides persistent context.

Add one source-lint spec under `apps/web/src/common/api/` that rejects common direct API `.message`
display patterns. Keep exemptions narrow and documented; do not blanket-ban `.message`, because
non-display retry/stale predicates and local browser errors can legitimately inspect it.

## 6. Phase 4 — Persisted Diagnostic Surfaces

Audit UI fields named or behaving like:

- `errorMessage`, `lastError`, `deliveryError`, `failureReason`;
- workflow/run/report failure detail;
- notification or provider delivery diagnostics.

At each customer surface:

1. use a reviewed stable code mapping when present;
2. otherwise show a generic Thai sentence appropriate to that workflow;
3. do not render stored provider/worker text;
4. do not rewrite or delete the persisted raw value.

Support/operator logging and backend 5xx redaction are not changed in this phase. Record any backend
leak found as a separate follow-up rather than expanding this patch.

## 7. Phase 5 — Browser Regression and Gates

Update or extend `e2e/toast-feedback.spec.ts` with the exact reported response:

```json
{
  "statusCode": 400,
  "message": ["property visibility should not exist"],
  "error": "Bad Request"
}
```

Assert:

- one visible error toast with `role="alert"`;
- exact canonical Thai validation fallback;
- no `visibility`, `property`, or `should not exist`;
- no duplicate error toast.

Verification, in order:

1. focused shared error/HTTP-client/source-guard specs;
2. full web unit suite;
3. web typecheck;
4. web build when the baseline permits it;
5. focused browser E2E against the local Docker stack;
6. `git diff --check` on touched files.

Record unrelated dirty-tree or baseline failures separately. Do not modify or stage unrelated legal,
test-data, or generated artifacts to make these gates pass.

## 8. Review Follow-up — Close Non-HTTP-Error Bypasses

The independent review found three paths that the first pass did not cover. Complete them before
marking this plan done:

1. Treat malformed 2xx JSON as an API-shaped `invalid_response`, tag real fetch failures at the
   request boundary, preserve stable codes in all legacy mapper branches, and distinguish a
   temporary refresh outage from a truly expired session.
2. Route tax preview/import diagnostics, banking import-row errors, and ledger readiness messages
   through reviewed domain renderers with safe Thai unknown fallbacks. Extend the source guard to
   cover `.errors`, `.warnings`, and result/check messages.
3. Remove or explicitly suppress duplicate feature-owned mutation error toasts while retaining
   persistent inline state and the existing shared mutation-toast owner.

Focused checks cover malformed 2xx JSON, a non-network `TypeError`, refresh outage classification,
legacy code preservation, each success-payload diagnostic family, and one-toast ownership.

## 9. Test Matrix

| Layer | Case | Expected evidence |
|---|---|---|
| Renderer | exact unknown-property 400 array | exact Thai fallback; no technical token |
| Renderer | mapped code plus raw technical message | mapped code copy wins |
| Renderer | `statusCode` only | same fallback as `status` |
| Renderer | unknown 500/default Nest text | generic Thai server failure |
| Renderer | network/`network_error` | canonical Thai network copy |
| API seam | failed mutation response | one mapped toast before rejection; raw details retained |
| API seam | rejected mutation fetch | one network toast before rejection |
| API seam | failed GET/rejected GET | no automatic toast |
| API seam | `suppressErrorToast` | no toast |
| Source guard | new direct `.message` display | test fails with file path |
| Persisted diagnostic | unmapped provider/workflow text | generic Thai workflow copy |
| E2E | exact screenshot response | one accessible friendly toast, no raw text |

## 10. Rollback and Risk

- Presentation changes are independently reversible; no schema or API contract migration is needed.
- Do not roll back to raw API text as a diagnostic aid. Raw data remains on the error/details path.
- The main behavioral risk is hiding a previously useful but unreviewed business sentence. When a
  fallback is too generic, add a reviewed stable code/message mapping rather than restoring global
  pass-through.
- The source guard can produce false positives. Resolve them with a narrow documented non-display
  exemption, not a broad directory exclusion.
- Backend 5xx bodies remain a separate trust boundary and follow-up; this plan only guarantees the
  customer web presentation boundary.

## 11. Completion Definition

The task is complete when all spec acceptance criteria pass, the exact substitute-receipt validation
response renders friendly Thai through the global seam, all mounted direct API-message display
bypasses and persisted diagnostic surfaces in scope are closed, and verification evidence is
recorded in task memory.
